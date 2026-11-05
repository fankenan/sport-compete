# -*- coding: utf-8 -*-
"""点击时间清除整段 —— 后端接口实测（用临时赛事隔离，测完全删）
   1) 仅某一天：该日期该时段全清，其他日期不受影响
   2) 所有日期同一时刻：多天的同一时刻一起清
   3) 有已录分：默认拒绝；force=1 才允许
   4) 占位槽一并清除；关联数据（成绩/裁判）一并清理
   5) 空时段：明确提示
"""
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
    return run(f"""mysql -ucompete -pprocess.env.SPORT_DB_PASSWORD sport_compete -N -e "{sql}" 2>&1 | grep -v Warning""").replace('\t', '|').replace('\n', '|')


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


# ---------- 清理历史残留 ----------
mq("DELETE FROM competition WHERE name='__clear_time_test__'")

# ---------- 造隔离数据 ----------
print('== 准备隔离数据 ==')
mq("""INSERT INTO competition (name, year, stage, start_date, end_date, status)
VALUES ('__clear_time_test__', 2027, 0, '2027-01-01', '2027-01-02', 3)""")
CID = mq("SELECT id FROM competition WHERE name='__clear_time_test__'").strip('|')
CID = int(CID)
print('  临时赛事 id:', CID)

mq(f"""INSERT INTO venue (competition_id, name, venue_no, sort_no) VALUES
({CID},'测场地1',1,1),({CID},'测场地2',2,2)""")
V1 = int(mq(f"SELECT id FROM venue WHERE competition_id={CID} AND venue_no=1").strip('|'))
V2 = int(mq(f"SELECT id FROM venue WHERE competition_id={CID} AND venue_no=2").strip('|'))

# 两天 09:00 各 2 个槽 + 另一时段 10:00 + 一个占位
mq(f"""INSERT INTO schedule_slot (competition_id,play_date,venue_id,slot_index,start_time,end_time,slot_type,occupation) VALUES
({CID},'2027-01-01',{V1},1,'09:00:00','09:40:00',1,NULL),
({CID},'2027-01-01',{V2},1,'09:00:00','09:40:00',1,NULL),
({CID},'2027-01-02',{V1},1,'09:00:00','09:40:00',1,NULL),
({CID},'2027-01-01',{V1},2,'10:00:00','10:40:00',1,NULL),
({CID},'2027-01-02',{V2},2,'09:00:00','09:40:00',2,'开幕式')""")

# 取现有报名队伍做对阵（只读引用，不改动）
teams = mq("SELECT id, band_id, event_item_id FROM team_entry WHERE status=2 LIMIT 2").strip('|').split('|')
T1, BID, EID = int(teams[0]), int(teams[1]), int(teams[2])
T2 = int(mq("SELECT id FROM team_entry WHERE status=2 LIMIT 2").strip('|').split('|')[-1])

S1 = int(mq(f"SELECT id FROM schedule_slot WHERE competition_id={CID} AND play_date='2027-01-01' AND venue_id={V1} AND start_time='09:00:00'").strip('|'))
S2 = int(mq(f"SELECT id FROM schedule_slot WHERE competition_id={CID} AND play_date='2027-01-01' AND venue_id={V2} AND start_time='09:00:00'").strip('|'))

# 两场比赛：S1 未录分，S2 已录分（还要给它造成绩/裁判记录）
mq(f"""INSERT INTO match_info (competition_id,band_id,event_item_id,stage,round_no,seq_no,team_a_id,team_b_id,slot_id,status)
VALUES ({CID},{BID},{EID},1,0,1,{T1},{T2},{S1},0)""")
mq(f"""INSERT INTO match_info (competition_id,band_id,event_item_id,stage,round_no,seq_no,team_a_id,team_b_id,slot_id,status,score_a,score_b)
VALUES ({CID},{BID},{EID},1,0,2,{T1},{T2},{S2},1,3,1)""")
M2 = int(mq(f"SELECT id FROM match_info WHERE slot_id={S2}").strip('|'))
mq(f"INSERT INTO match_result (match_id,team_entry_id,scored,conceded,is_win,is_draw) VALUES ({M2},{T1},3,1,1,0),({M2},{T2},1,3,0,0)")
mq(f"INSERT INTO match_referee (match_id,referee_id,role) VALUES ({M2},1,1)")

print('  槽位:', mq(f"SELECT COUNT(*) FROM schedule_slot WHERE competition_id={CID}").strip('|'),
      '比赛:', mq(f"SELECT COUNT(*) FROM match_info WHERE competition_id={CID}").strip('|'))

print('\n== 场景1：有已录分，默认应拒绝 ==')
r = api('POST', '/api/schedule/clear-time', {
    'competition_id': CID, 'start_time': '09:00', 'play_date': '2027-01-01'
})
print('  返回:', r)
check('已录分时默认拒绝', r.get('code') != 0, r.get('message', '')[:60])
check('拒绝时数据未被改动', mq(f"SELECT COUNT(*) FROM schedule_slot WHERE competition_id={CID}").strip('|') == '5')

print('\n== 场景2：仅清除 2027-01-01 的 09:00 ==')
# 先撤掉已录分状态，模拟普通情况
mq(f"UPDATE match_info SET status=0, score_a=NULL, score_b=NULL WHERE id={M2}")
r = api('POST', '/api/schedule/clear-time', {
    'competition_id': CID, 'start_time': '09:00', 'play_date': '2027-01-01'
})
print('  返回:', r)
check('清除成功', r.get('code') == 0, r.get('message', '')[:60])
if r.get('code') == 0:
    d = r['data']
    check('删掉 2 个槽位', d['slots'] == 2, f"实际 {d['slots']}")
    check('删掉 2 场比赛', d['matches'] == 2, f"实际 {d['matches']}")
left = mq(f"SELECT COUNT(*) FROM schedule_slot WHERE competition_id={CID}").strip('|')
check('总数 5 → 3', left == '3', f'剩余 {left}')
check('另一天的 09:00 还在',
      mq(f"SELECT COUNT(*) FROM schedule_slot WHERE competition_id={CID} AND play_date='2027-01-02' AND start_time='09:00:00'").strip('|') == '2')
check('另一时段 10:00 没被误删',
      mq(f"SELECT COUNT(*) FROM schedule_slot WHERE competition_id={CID} AND start_time='10:00:00'").strip('|') == '1')
check('比赛已一并删除', mq(f"SELECT COUNT(*) FROM match_info WHERE competition_id={CID}").strip('|') == '0')
check('关联成绩已清理', mq("SELECT COUNT(*) FROM match_result WHERE match_id=%d" % M2).strip('|') == '0')
check('关联裁判已清理', mq("SELECT COUNT(*) FROM match_referee WHERE match_id=%d" % M2).strip('|') == '0')

print('\n== 场景3：清除所有日期的 09:00（含占位槽）==')
r = api('POST', '/api/schedule/clear-time', {'competition_id': CID, 'start_time': '9:00'})
print('  返回:', r)
check('跨日期清除成功', r.get('code') == 0, r.get('message', '')[:60])
if r.get('code') == 0:
    check('剩 2 个槽（含占位）都被删', r['data']['slots'] == 2, f"实际 {r['data']['slots']}")
check('占位槽已清除', mq(f"SELECT COUNT(*) FROM schedule_slot WHERE competition_id={CID} AND slot_type=2").strip('|') == '0')
check('只剩 10:00 那一个槽', mq(f"SELECT COUNT(*) FROM schedule_slot WHERE competition_id={CID}").strip('|') == '1')

print('\n== 场景4：force=1 强制清已录分 ==')
mq(f"""INSERT INTO schedule_slot (competition_id,play_date,venue_id,slot_index,start_time,end_time,slot_type)
VALUES ({CID},'2027-01-01',{V1},3,'11:00:00','11:40:00',1)""")
S3 = int(mq(f"SELECT id FROM schedule_slot WHERE competition_id={CID} AND start_time='11:00:00'").strip('|'))
mq(f"""INSERT INTO match_info (competition_id,band_id,event_item_id,stage,round_no,seq_no,team_a_id,team_b_id,slot_id,status,score_a,score_b)
VALUES ({CID},{BID},{EID},1,0,3,{T1},{T2},{S3},1,2,0)""")
M3 = int(mq(f"SELECT id FROM match_info WHERE slot_id={S3}").strip('|'))
r_no = api('POST', '/api/schedule/clear-time', {'competition_id': CID, 'start_time': '11:00'})
check('不 force 时拒绝', r_no.get('code') != 0, r_no.get('message', '')[:50])
r_yes = api('POST', '/api/schedule/clear-time', {'competition_id': CID, 'start_time': '11:00', 'force': 1})
check('force=1 时可以清除', r_yes.get('code') == 0, r_yes.get('message', '')[:50])
if r_yes.get('code') == 0:
    check('确实删掉了这一场', r_yes['data']['matches'] == 1)

print('\n== 场景5：空时段提示 ==')
r = api('POST', '/api/schedule/clear-time', {'competition_id': CID, 'start_time': '23:00'})
check('空时段给出提示', r.get('code') != 0, r.get('message', '')[:50])

print('\n== 场景6：格式兼容 HH:mm:00 ==')
mq(f"""INSERT INTO schedule_slot (competition_id,play_date,venue_id,slot_index,start_time,end_time,slot_type)
VALUES ({CID},'2027-01-01',{V1},4,'14:00:00','14:40:00',1)""")
r = api('POST', '/api/schedule/clear-time', {'competition_id': CID, 'start_time': '14:00:00'})
check('带秒的时间也能匹配', r.get('code') == 0, r.get('message', '')[:50])

# ---------- 清理 ----------
mq(f"DELETE FROM match_info WHERE competition_id={CID}")
mq(f"DELETE FROM schedule_slot WHERE competition_id={CID}")
mq(f"DELETE FROM venue WHERE competition_id={CID}")
mq(f"DELETE FROM event_item WHERE competition_id={CID}")
mq("DELETE FROM competition WHERE name='__clear_time_test__'")
print('\n  清理后残留:', mq("SELECT COUNT(*) FROM competition WHERE name='__clear_time_test__'").strip('|'))

print(f'\n===== 通过 {len(PASS)} / 失败 {len(FAIL)} =====')
if FAIL:
    print('失败项:', FAIL)
