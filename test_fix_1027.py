# -*- coding: utf-8 -*-
"""2026-10-27 三项修复端到端实测
   1) 分组编排：生成后 GET /group/list 能回显（模拟重新登录）
   2) 赛程编排：拖到空槽（已有槽 / 自动建槽）
   3) 赛程编排：拖到已被占用的槽 → 返回明确提示
"""
import json
import os
import paramiko

HOST = _ENV['SPORT_SSH_HOST']
USER = _ENV['SPORT_SSH_USER']
PWD  = _ENV['SPORT_SSH_PASSWORD']
cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(HOST, 22, USER, PWD, timeout=15)



def _env(name, fallback=None):
    """读环境变量；未设置时返回 fallback（可为 None 表示必须显式配置）"""
    return os.environ.get(name, fallback)


def _require_env(name):
    v = os.environ.get(name)
    if not v:
        raise SystemExit(
            '[安全] 缺少环境变量 %s。\n'
            '  本脚本会连接真实服务器/数据库，凭据不再写在代码里。\n'
            '  请先设置环境变量后重试。' % name
        )
    return v

def run(cmd, t=240):
    _, o, e = cli.exec_command(cmd, timeout=t)
    return o.read().decode('utf-8', 'replace').strip(), e.read().decode('utf-8', 'replace').strip()


def mq(sql):
    o, e = run(f"""mysql -ucompete -pprocess.env.SPORT_DB_PASSWORD sport_compete -N -e "{sql}" 2>&1 | grep -v Warning""")
    # mysql -N 用制表符分隔列，统一换成 |
    return (o or e).strip().replace('\t', '|')


PASS, FAIL = [], []


def check(name, cond, detail=''):
    if cond:
        PASS.append(name)
        print(f'  [OK] {name} {detail}')
    else:
        FAIL.append(name)
        print(f'  [!!] {name} {detail}')


# ---------- token ----------
o, e = run("""cd /home/single/sport-compete/server && set -a && . ./.env && set +a && node -e "
const jwt=require('jsonwebtoken');
console.log(jwt.sign({id:1,username:'admin',role:1,real_name:'管理员'}, process.env.JWT_SECRET, {expiresIn:'2h'}));
" """)
TOKEN = (o or e).strip().split('\n')[-1]


def api(method, path, body=None):
    if body is None:
        cmd = f"""curl -s -X {method} -H "Authorization: Bearer {TOKEN}" -H "Content-Type: application/json" "http://127.0.0.1:4100{path}\""""
    else:
        js = json.dumps(body, ensure_ascii=False).replace('"', '\\"')
        cmd = f"""curl -s -X {method} -H "Authorization: Bearer {TOKEN}" -H "Content-Type: application/json" -d "{js}" "http://127.0.0.1:4100{path}\""""
    o, e = run(cmd)
    try:
        return json.loads(o)
    except Exception:
        return {'raw': o[:300], 'err': e[:200]}


# ============================================================
print('\n===== 1. 分组编排回显 =====')
# 取一个真实赛事（有已审核队伍的球类项目）
row = mq("""SELECT c.id, te.event_item_id
FROM competition c
JOIN team_entry te ON te.competition_id=c.id AND te.status=2
JOIN event_item ei ON ei.id=te.event_item_id AND ei.category=3
ORDER BY c.id DESC LIMIT 1""")
print('  候选(赛事|项目):', row)
if '|' not in row:
    check('存在可用于分组的球类项目', False, row)
else:
    CID, EID = [int(x) for x in row.split('|')]

    g = api('POST', '/api/group/generate', {'competition_id': CID, 'event_item_id': EID})
    print('  执行分组:', json.dumps(g, ensure_ascii=False)[:150])
    check('执行分组成功', g.get('code') == 0)

    # 模拟"退出登录再进来"：重新拉一次列表
    lst = api('GET', f'/api/group/list?competition_id={CID}&event_item_id={EID}')
    data = lst.get('data') if isinstance(lst, dict) else lst
    n = len(data) if isinstance(data, list) else 0
    check('重新登录后能回显已保存分组', isinstance(data, list) and n > 0, f'共 {n} 组')

    # 不带项目参数也要能查到（供 autoPickSaved 自动定位）
    allg = api('GET', f'/api/group/list?competition_id={CID}')
    ad = allg.get('data') if isinstance(allg, dict) else allg
    check('不带项目参数也能查到分组', isinstance(ad, list) and len(ad) > 0, f'共 {len(ad) if isinstance(ad, list) else 0} 组')


# ============================================================
print('\n===== 2. 赛程编排拖拽 =====')
row2 = mq("""SELECT m.competition_id, m.id, m.slot_id
FROM match_info m
JOIN schedule_slot ss ON ss.id = m.slot_id
ORDER BY m.competition_id DESC LIMIT 1""")

MADE_DATA = False
OLD_SLOT_IDS = set()

if '|' not in row2:
    # 当前库里没有已排期的比赛：在有时间槽的赛事上临时造一批，测完清理
    print('  （库里暂无已排期比赛，临时造数据后测完清理）')
    MADE_DATA = True
    tmp = mq("""SELECT ss.competition_id, ei.id
    FROM schedule_slot ss
    JOIN event_item ei ON ei.competition_id = ss.competition_id AND ei.category = 3
    ORDER BY ss.competition_id DESC LIMIT 1""")
    C2, EID2 = [int(x) for x in tmp.split('|')]
    OLD_SLOT_IDS = set(x for x in mq(f'SELECT id FROM schedule_slot WHERE competition_id={C2}').split('\n') if x)
    api('POST', '/api/group/generate', {'competition_id': C2, 'event_item_id': EID2})
    gm = api('POST', '/api/group/generate-matches', {'competition_id': C2, 'event_item_id': EID2})
    print('  造小组赛:', json.dumps(gm, ensure_ascii=False)[:120])
    pk = api('POST', '/api/schedule/pack', {'competition_id': C2})
    print('  装箱:', json.dumps(pk, ensure_ascii=False)[:120])
    row2 = mq(f"""SELECT m.competition_id, m.id, m.slot_id
    FROM match_info m JOIN schedule_slot ss ON ss.id = m.slot_id
    WHERE m.competition_id = {C2} LIMIT 1""")

print('  候选(赛事|场次|槽):', row2)
if '|' not in row2:
    check('存在已排期的比赛', False, row2)
else:
    C2, MID, FROM_SLOT = [int(x) for x in row2.split('|')]

    gantt = api('GET', f'/api/schedule/gantt?competition_id={C2}')
    gd = gantt.get('data') if isinstance(gantt, dict) else gantt
    cells = gd.get('cells', []) if isinstance(gd, dict) else []
    venues = gd.get('venues', []) if isinstance(gd, dict) else []
    check('甘特图可读', len(cells) > 0 and len(venues) > 0, f'{len(cells)} 槽 / {len(venues)} 场地')

    # 2.1 拖到"已有但为空"的槽
    empty = next((c for c in cells if c.get('slot_type') == 1 and not c.get('match')), None)
    if empty:
        r = api('PUT', f'/api/schedule/match/{MID}', {'slot_id': empty['slot_id']})
        check('拖到已有空槽成功', r.get('code') == 0, json.dumps(r, ensure_ascii=False)[:160])
        moved = mq(f"SELECT slot_id FROM match_info WHERE id={MID}")
        check('数据库 slot_id 已更新', str(moved) == str(empty['slot_id']), f'{FROM_SLOT} -> {moved}')
    else:
        check('存在空时间槽', False)

    # 2.2 拖到别的场地的空白格（该 time 行存在但本场地没有槽 → 自动建槽）
    cur = next((c for c in cells if c.get('match') and c['match']['id'] == MID), None)
    if cur:
        same_time_other_venue = next(
            (v for v in venues if v['venue_no'] != cur['venue_no']), None)
        has_slot = next(
            (c for c in cells if c['date'] == cur['date']
             and c['start_time'] == cur['start_time']
             and c['venue_no'] == (same_time_other_venue or {}).get('venue_no')), None)
        if same_time_other_venue and not has_slot:
            before = int(mq('SELECT COUNT(*) FROM schedule_slot'))
            r = api('PUT', f'/api/schedule/match/{MID}', {
                'play_date': cur['date'],
                'start_time': cur['start_time'],
                'venue_id': same_time_other_venue['id']
            })
            after = int(mq('SELECT COUNT(*) FROM schedule_slot'))
            check('拖到空白格自动建槽', r.get('code') == 0 and after == before + 1,
                  json.dumps(r, ensure_ascii=False)[:160])
        else:
            print('  (跳过自动建槽用例：该时间点目标场地已有槽)')

    # 2.3 拖到已被占用的槽 → 应给出明确提示
    other = next((c for c in cells if c.get('match') and c['match']['id'] != MID), None)
    if other:
        r = api('PUT', f'/api/schedule/match/{MID}', {'slot_id': other['slot_id']})
        msg = r.get('message', '')
        check('占用槽返回明确提示', r.get('code') != 0 and '已有第' in msg, msg[:80])
    else:
        print('  (跳过占用提示用例：只有一场比赛)')

    # 2.4 拖到占位槽
    blk = next((c for c in cells if c.get('slot_type') == 2), None)
    if blk:
        r = api('PUT', f'/api/schedule/match/{MID}', {'slot_id': blk['slot_id']})
        check('占位槽拒绝落位', r.get('code') != 0 and '占用' in r.get('message', ''), r.get('message', '')[:80])
    else:
        print('  (跳过占位用例：无占位槽)')

    # 还原：放回原槽
    api('PUT', f'/api/schedule/match/{MID}', {'slot_id': FROM_SLOT})
    back = mq(f"SELECT slot_id FROM match_info WHERE id={MID}")
    check('已还原到原时间槽', str(back) == str(FROM_SLOT), f'当前 {back}')

    # 清理：只删本次造出来的比赛与新建的槽，原有时间槽一个不动
    if MADE_DATA:
        mq(f'DELETE FROM match_info WHERE competition_id={C2}')
        now_ids = set(mq(f'SELECT id FROM schedule_slot WHERE competition_id={C2}').split('\n'))
        new_ids = [i for i in now_ids if i and i not in OLD_SLOT_IDS]
        if new_ids:
            mq(f'DELETE FROM schedule_slot WHERE id IN ({",".join(new_ids)})')
        print(f'  （已清理临时数据：删 {len(new_ids)} 个新建槽 + 全部临时比赛）')


print(f'\n===== 结果：通过 {len(PASS)}，失败 {len(FAIL)} =====')
if FAIL:
    print('失败项：', '、'.join(FAIL))
cli.close()
