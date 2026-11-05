# -*- coding: utf-8 -*-
"""对阵图 bracket 接口实测（临时赛事隔离）"""
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


mq("DELETE FROM competition WHERE name='__bracket_test__'")
# 清掉上次中断可能留下的关联数据
for old in [x for x in mq("SELECT id FROM competition WHERE name LIKE '__bracket%'").split(',') if x.strip().isdigit()]:
    mq(f"DELETE FROM match_info WHERE competition_id={old}")
    mq(f"DELETE FROM team_entry WHERE competition_id={old}")
    mq(f"DELETE FROM event_item WHERE competition_id={old}")
    mq(f"DELETE FROM competition WHERE id={old}")
mq("""INSERT INTO competition (name, year, stage, status) VALUES ('__bracket_test__', 2027, 0, 3)""")
CID = int(mq("SELECT id FROM competition WHERE name='__bracket_test__'").strip('|'))
mq(f"""INSERT INTO event_item (competition_id, name, category) VALUES ({CID}, '测试篮球', 3)""")
EID = int(mq(f"SELECT id FROM event_item WHERE competition_id={CID} LIMIT 1").strip('|'))
BID = int(mq("SELECT id FROM group_band LIMIT 1").strip('|'))

teams = [int(x) for x in mq("SELECT id FROM team_entry WHERE status=2 LIMIT 8").split(',') if x.strip().isdigit()]

# 不够 8 支就在临时赛事里补假队伍（school_id 用 0，仅测试引用）
if len(teams) < 8:
    mq(f"""INSERT INTO team_entry (competition_id, band_id, event_item_id, school_id, team_name, status)
     VALUES {','.join(f'({CID},{BID},{EID},{900001 + i},\'测试队伍{i + 1}\',2)' for i in range(8))}""")
    teams = [int(x) for x in mq(f"SELECT id FROM team_entry WHERE competition_id={CID}").split(',') if x.strip().isdigit()]
    TEST_TEAMS = True
else:
    TEST_TEAMS = False
print('临时赛事:', CID, '项目:', EID, '组别:', BID, '可用队伍:', len(teams))
assert len(teams) >= 8

# stage 2 八进四 4 场（完赛，胜者 team_a）
seq = 1
pairs2 = [(teams[0], teams[1]), (teams[2], teams[3]), (teams[4], teams[5]), (teams[6], teams[7])]
for a, b in pairs2:
    mq(f"""INSERT INTO match_info (competition_id,band_id,event_item_id,stage,seq_no,team_a_id,team_b_id,status,score_a,score_b)
     VALUES ({CID},{BID},{EID},2,{seq},{a},{b},1,3,1)""")
    seq += 1

# stage 3 半决赛 2 场（胜者 a）
s3 = [(teams[0], teams[2]), (teams[4], teams[6])]
for a, b in s3:
    mq(f"""INSERT INTO match_info (competition_id,band_id,event_item_id,stage,seq_no,team_a_id,team_b_id,status,score_a,score_b)
     VALUES ({CID},{BID},{EID},3,{seq},{a},{b},1,2,1)""")
    seq += 1

# stage 5 决赛（teams[0] 胜） + stage 6 三四名
mq(f"""INSERT INTO match_info (competition_id,band_id,event_item_id,stage,seq_no,team_a_id,team_b_id,status,score_a,score_b)
 VALUES ({CID},{BID},{EID},5,{seq},{teams[0]},{teams[2]},1,5,4)""")
seq += 1
mq(f"""INSERT INTO match_info (competition_id,band_id,event_item_id,stage,seq_no,team_a_id,team_b_id,status,score_a,score_b)
 VALUES ({CID},{BID},{EID},6,{seq},{teams[4]},{teams[6]},1,3,2)""")

print('\n== 管理端 /schedule/bracket ==')
r = api('GET', f'/api/schedule/bracket?competition_id={CID}&event_item_id={EID}&band_id={BID}')
check('接口可用', r.get('code') == 0, r.get('message', '')[:50])
d = r.get('data') or {}
rounds = d.get('rounds') or []
print('  轮次列:', [(x['stage'], x['label'], len(x['matches'])) for x in rounds])
check('4 列齐全', len(rounds) == 4)
check('列顺序 八进四→半决赛→三四名→决赛',
      [x['stage'] for x in rounds] == [2, 3, 6, 5])
check('场次数量 4/2/1/1', [len(x['matches']) for x in rounds] == [4, 2, 1, 1])
check('三四名列带 side 标记', rounds[2].get('side') == 'bottom')

r2 = rounds[0]['matches'][0]
check('胜者识别正确', r2['winner_id'] == r2['team_a_id'], f"{r2['team_a']} {r2['score_a']}:{r2['score_b']} {r2['team_b']}")
check('冠军取决赛胜者', d.get('champion') is not None, str(d.get('champion')))

# 冠军队名与 teams[0] 对应
name0 = mq(f"SELECT team_name FROM team_entry WHERE id={teams[0]}").strip('|').split(',')[0]
check('冠军队名匹配', d.get('champion') == name0, f"{d.get('champion')} / {name0}")

print('\n== 公开端 /public/meet/:uuid/bracket ==')
mq(f"UPDATE competition SET uuid='bracket-test-uuid', public_flag=1 WHERE id={CID}")
r2j = run(f"curl -s \"http://127.0.0.1:4100/api/public/meet/bracket-test-uuid/bracket?event_item_id={EID}&band_id={BID}\"")
try:
    pd = json.loads(r2j)
    check('公开端可用（免登录）', pd.get('code') == 0)
    check('公开端数据一致', len((pd.get('data') or {}).get('rounds') or []) == 4)
except Exception:
    check('公开端可用（免登录）', False, r2j[:120])

# 缺参数
r3 = api('GET', f'/api/schedule/bracket?competition_id={CID}')
check('缺参数被拦截', r3.get('code') != 0, r3.get('message', '')[:40])

print('\n== 清理 ==')
mq(f"DELETE FROM match_info WHERE competition_id={CID}")
mq(f"DELETE FROM team_entry WHERE competition_id={CID}")
mq(f"DELETE FROM event_item WHERE competition_id={CID}")
mq(f"DELETE FROM group_band WHERE competition_id={CID}")
mq(f"DELETE FROM competition WHERE name='__bracket_test__'")
print('  残留:', mq("SELECT COUNT(*) FROM competition WHERE name='__bracket_test__'").strip('|'))

print(f'\n===== 通过 {len(PASS)} / 失败 {len(FAIL)} =====')
if FAIL:
    print('失败:', FAIL)
