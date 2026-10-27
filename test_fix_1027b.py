# -*- coding: utf-8 -*-
"""补充实测：拖到"完全空白格"（自动建槽）与"占位槽"（拒绝落位）"""
import json
import paramiko

HOST, USER, PWD = '10.128.1.45', 'single', 'jyj2026'
cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(HOST, 22, USER, PWD, timeout=15)


def run(cmd, t=240):
    _, o, e = cli.exec_command(cmd, timeout=t)
    return o.read().decode('utf-8', 'replace').strip(), e.read().decode('utf-8', 'replace').strip()


def mq(sql):
    o, e = run(f"""mysql -ucompete -p'Compete@2026' sport_compete -N -e "{sql}" 2>&1 | grep -v Warning""")
    return (o or e).strip().replace('\t', '|')


PASS, FAIL = [], []


def check(name, cond, detail=''):
    if cond:
        PASS.append(name); print(f'  [OK] {name} {detail}')
    else:
        FAIL.append(name); print(f'  [!!] {name} {detail}')


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


C = 6
EID = 11
OLD_SLOT_IDS = set(x for x in mq(f'SELECT id FROM schedule_slot WHERE competition_id={C}').split('\n') if x)

print('\n===== 造数据 =====')
api('POST', '/api/group/generate', {'competition_id': C, 'event_item_id': EID})
api('POST', '/api/group/generate-matches', {'competition_id': C, 'event_item_id': EID})
api('POST', '/api/schedule/pack', {'competition_id': C})

g = api('GET', f'/api/schedule/gantt?competition_id={C}')
gd = g.get('data', {})
cells, venues = gd.get('cells', []), gd.get('venues', [])
withmatch = [c for c in cells if c.get('match')]
check('已有排期比赛', len(withmatch) > 0, f'{len(withmatch)} 场')

cur = withmatch[0]
MID = cur['match']['id']
FROM_SLOT = cur['slot_id']

# ---------- 用例 A：人为挖一个空档（该时间点目标场地无槽），拖过去应自动建槽 ----------
target_venue = next(v for v in venues if v['venue_no'] != cur['venue_no'])
gap_slot = next((c for c in cells
                 if c['date'] == cur['date'] and c['start_time'] == cur['start_time']
                 and c['venue_no'] == target_venue['venue_no']), None)
if gap_slot:
    mq(f"DELETE FROM schedule_slot WHERE id={gap_slot['slot_id']}")
    print(f"  已挖空档：{cur['date']} {cur['start_time']} 场地{target_venue['venue_no']}")

before = len([x for x in mq(f'SELECT id FROM schedule_slot WHERE competition_id={C}').split('\n') if x])
r = api('PUT', f'/api/schedule/match/{MID}', {
    'play_date': cur['date'], 'start_time': cur['start_time'], 'venue_id': target_venue['id']})
after = len([x for x in mq(f'SELECT id FROM schedule_slot WHERE competition_id={C}').split('\n') if x])
check('拖到完全空白格 → 自动建槽并落位', r.get('code') == 0 and after == before + 1,
      f'{json.dumps(r, ensure_ascii=False)[:110]} 槽数 {before}->{after}')

ns = mq(f"""SELECT TIME_FORMAT(start_time,'%H:%i'), TIME_FORMAT(end_time,'%H:%i'), slot_type
FROM schedule_slot WHERE id=(SELECT slot_id FROM match_info WHERE id={MID})""")
check('新建槽时间正确', ns.split('|')[0] == cur['start_time'], ns)

# ---------- 用例 B：占位槽拒绝落位 ----------
blk_venue = next(v for v in venues if v['venue_no'] != target_venue['venue_no'])
r2 = api('POST', '/api/schedule/block', {
    'competition_id': C, 'play_date': cur['date'], 'venue_id': blk_venue['id'],
    'occupation': '开幕式', 'slot_type': 2})
blk_cells = api('GET', f'/api/schedule/gantt?competition_id={C}').get('data', {}).get('cells', [])
blk = next((c for c in blk_cells if c.get('slot_type') == 2), None)
if blk:
    r3 = api('PUT', f'/api/schedule/match/{MID}', {'slot_id': blk['slot_id']})
    check('拖到占位槽被拒绝', r3.get('code') != 0 and '占用' in r3.get('message', ''), r3.get('message', '')[:80])
else:
    check('占位槽创建成功', False, json.dumps(r2, ensure_ascii=False)[:120])

# ---------- 清理 ----------
mq(f'DELETE FROM match_info WHERE competition_id={C}')
mq(f'UPDATE schedule_slot SET slot_type=1, occupation=NULL WHERE competition_id={C} AND slot_type=2')
now_ids = set(x for x in mq(f'SELECT id FROM schedule_slot WHERE competition_id={C}').split('\n') if x)
new_ids = [i for i in now_ids if i and i not in OLD_SLOT_IDS]
if new_ids:
    mq(f'DELETE FROM schedule_slot WHERE id IN ({",".join(new_ids)})')
print(f'  已清理：删 {len(new_ids)} 个临时槽，比赛清空，占位还原')

print(f'\n===== 结果：通过 {len(PASS)}，失败 {len(FAIL)} =====')
if FAIL:
    print('失败项：', '、'.join(FAIL))
cli.close()
