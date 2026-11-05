# -*- coding: utf-8 -*-
"""验证：gantt 返回比赛携带 band_id / event_item_id，前端按此筛选不再全隐藏"""
import json
import os
import paramiko

# ---- 凭据从环境变量读取（不要写死在代码里）----
# 必填：SPORT_SSH_PASSWORD
# 选填：SPORT_SSH_HOST / SPORT_SSH_USER / SPORT_SUDO_PASSWORD / SPORT_DB_PASSWORD
_ENV = os.environ.copy()
_ENV['SPORT_SSH_HOST'] = os.environ.get('SPORT_SSH_HOST', '10.128.1.45')
_ENV['SPORT_SSH_USER'] = os.environ.get('SPORT_SSH_USER', 'single')
_ENV['SPORT_SSH_PASSWORD'] = os.environ.get('SPORT_SSH_PASSWORD', '')
_ENV['SPORT_SUDO_PASSWORD'] = os.environ.get('SPORT_SUDO_PASSWORD', '')
_ENV['SPORT_DB_PASSWORD'] = os.environ.get('SPORT_DB_PASSWORD', '')

if not _ENV['SPORT_SSH_PASSWORD']:
    raise SystemExit(
        '[安全] 缺少环境变量 SPORT_SSH_PASSWORD。\n'
        '  本脚本会连接真实服务器，凭据不再写在代码里。\n'
        '  请先 export SPORT_SSH_PASSWORD=... 后重试。'
    )


cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(_ENV['SPORT_SSH_HOST'], 22, _ENV['SPORT_SSH_USER'], _ENV['SPORT_SSH_PASSWORD'], timeout=15)


def run(cmd, t=180):
    _, o, e = cli.exec_command(cmd, timeout=t, env=_ENV)
    return o.read().decode('utf-8', 'replace').strip() or e.read().decode('utf-8', 'replace').strip()


def mq(sql):
    return run(f"""mysql -ucompete -pprocess.env.SPORT_DB_PASSWORD sport_compete -N -e "{sql}" 2>&1 | grep -v Warning""").replace('\t', '|').replace('\n', ',')


tok = run("""cd /home/single/sport-compete/server && set -a && . ./.env && set +a && node -e "
const j=require('jsonwebtoken');
console.log(j.sign({id:1,username:'admin',role:1,real_name:'管理员'}, process.env.JWT_SECRET, {expiresIn:'2h'}));
" """)
TOKEN = tok.strip().split('\n')[-1]


def api(m, p, b=None):
    if b is None:
        c = f'''curl -s -X {m} -H "Authorization: Bearer {TOKEN}" "http://127.0.0.1:4100{p}"'''
    else:
        js = json.dumps(b, ensure_ascii=False).replace('"', '\\"')
        c = f'''curl -s -X {m} -H "Authorization: Bearer {TOKEN}" -H "Content-Type: application/json" -d "{js}" "http://127.0.0.1:4100{p}"'''
    raw = run(c)
    try:
        return json.loads(raw)
    except Exception:
        return {'raw': raw[:200]}


PASS, FAIL = [], []


def check(name, cond, detail=''):
    (PASS if cond else FAIL).append(name)
    print(f'  [{"OK" if cond else "!!"}] {name} {detail}')


CID = 6
g = api('GET', f'/api/schedule/gantt?competition_id={CID}')
check('甘特图接口可用', g.get('code') == 0, g.get('message', '')[:40])

cells = g.get('cells') or g.get('data', {}).get('cells') or []
withMatch = [c for c in cells if c.get('match')]
print(f'  槽位总数 {len(cells)}，其中有比赛 {len(withMatch)}')

if withMatch:
    m = withMatch[0]['match']
    print('  比赛对象字段:', sorted(m.keys()))
    check('比赛带了 band_id', 'band_id' in m and m['band_id'] is not None, f"band_id={m.get('band_id')}")
    check('比赛带了 event_item_id', 'event_item_id' in m and m['event_item_id'] is not None, f"event_item_id={m.get('event_item_id')}")

    # 模拟前端筛选逻辑
    def visible(band, ev):
        out = 0
        for c in cells:
            if not c.get('match'):
                continue
            mm = c['match']
            hide = (band and int(mm.get('band_id')) != int(band)) or (ev and int(mm.get('event_item_id')) != int(ev))
            if not hide:
                out += 1
        return out

    BID, EID = withMatch[0]['match']['band_id'], withMatch[0]['match']['event_item_id']
    total = len(withMatch)
    check('选中该组别+项目时比赛可见', visible(BID, EID) == total, f'{visible(BID, EID)}/{total}')
    check('只选组别时比赛可见', visible(BID, None) == total, f'{visible(BID, None)}/{total}')
    check('只选项目时比赛可见', visible(None, EID) == total, f'{visible(None, EID)}/{total}')
    check('不选筛选时比赛可见', visible(None, None) == total)

    # 女队组别（目前没有女子比赛）
    girl = mq(f"SELECT id FROM group_band WHERE competition_id={CID} AND gender=2")
    gid = int(girl.split('|')[0]) if '|' in girl else None
    if gid:
        n = visible(gid, EID)
        print(f'  选女队组别({gid})+同项目：可见 {n} 场（当前女子无报名，预期 0）')
        check('无女子比赛时不串显示男子比赛', n == 0, f'可见 {n}')
        check('空筛选下男女比赛都显示', visible(None, None) == total)
    else:
        print('  （该赛事没有女队组别，跳过）')

print(f'\n===== 通过 {len(PASS)} / 失败 {len(FAIL)} =====')
if FAIL:
    print('失败项:', FAIL)
