# -*- coding: utf-8 -*-
"""点击空槽新增比赛 —— 后端链路实测
   1) 点已有空槽 → 复用该槽，不新建
   2) 点完全没有槽的格子 → 自动建槽并落比赛
   3) 点占位槽 → 明确提示
   4) 该时段已有比赛 → 明确提示
"""
import json
import paramiko

cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect('10.128.1.45', 22, 'single', 'jyj2026', timeout=15)


def run(cmd, t=180):
    _, o, e = cli.exec_command(cmd, timeout=t)
    return o.read().decode('utf-8', 'replace').strip() or e.read().decode('utf-8', 'replace').strip()


def mq(sql):
    return run(f"""mysql -ucompete -p'Compete@2026' sport_compete -N -e "{sql}" 2>&1 | grep -v Warning""").replace('\t', '|')


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


print('== 准备数据 ==')
# 取一个有队伍报名的 组别+项目
pair = mq("""SELECT band_id, event_item_id, COUNT(*) c FROM team_entry WHERE status=2
GROUP BY band_id, event_item_id HAVING c>=2 ORDER BY c DESC LIMIT 1""")
print('  组别|项目|队数:', pair)
if '|' not in pair:
    print('  没有报名数据，先造一批')
    raise SystemExit('缺少报名数据，无法实测')
BID, EID, _ = pair.split('|')
BID, EID = int(BID), int(EID)

teams = mq(f"""SELECT id FROM team_entry WHERE status=2 AND band_id={BID} AND event_item_id={EID} LIMIT 2""").replace('\n', '|').split('|')
T1, T2 = int(teams[0]), int(teams[1])
print('  两队:', T1, T2)

CID = int(mq(f"""SELECT competition_id FROM event_item WHERE id={EID} LIMIT 1"""))
print('  赛事:', CID)

# 该项目关掉主客场，避免重复对阵校验干扰（测完还原）
mq(f"UPDATE event_item SET home_away=1 WHERE id={EID}")

print('\n== 场景1：点击已存在的空槽 ==')
slot = mq(f"""SELECT ss.id, ss.play_date, TIME_FORMAT(ss.start_time,'%H:%i'), ss.venue_id
FROM schedule_slot ss
WHERE ss.competition_id={CID} AND ss.slot_type=1
  AND NOT EXISTS (SELECT 1 FROM match_info m WHERE m.slot_id=ss.id)
LIMIT 1""")
print('  空槽:', slot)
if '|' in slot:
    SID, DATE, TIME, VID = slot.split('|')
    SID, VID = int(SID), int(VID)
    before = int(mq(f"SELECT COUNT(*) FROM schedule_slot WHERE competition_id={CID}") or 0)
    r = api('POST', '/api/schedule/manual', {
        'competition_id': CID, 'band_id': BID, 'event_item_id': EID,
        'play_date': DATE, 'start_time': TIME, 'venue_id': VID,
        'team_a_id': T1, 'team_b_id': T2, 'stage': 1
    })
    print('  返回:', r)
    check('空槽可新增比赛', r.get('code') == 0, r.get('message', ''))
    if r.get('code') == 0:
        got = mq(f"SELECT slot_id FROM match_info WHERE id={r['data']['id']}")
        check('复用了点击的那个槽（没新建）', str(got) == str(SID), f'落槽 {got} / 期望 {SID}')
        after = int(mq(f"SELECT COUNT(*) FROM schedule_slot WHERE competition_id={CID}") or 0)
        check('槽总数未增加', after == before, f'{before} → {after}')
        # 清理
        api('DELETE', f"/api/schedule/match/{r['data']['id']}")
        check('已清理测试场次', mq(f"SELECT COUNT(*) FROM match_info WHERE id={r['data']['id']}") == '0')

print('\n== 场景2：点击完全没有槽的空格子 ==')
# 找一个该场地该日期没有槽的时间（用 21:30，一般不会有）
VID2 = int(mq(f"SELECT id FROM venue WHERE competition_id={CID} ORDER BY venue_no LIMIT 1") or 0)
DATE2 = mq(f"SELECT play_date FROM schedule_slot WHERE competition_id={CID} ORDER BY play_date LIMIT 1")
TIME2 = '21:35'
exists = mq(f"""SELECT COUNT(*) FROM schedule_slot WHERE competition_id={CID} AND play_date='{DATE2}'
AND venue_id={VID2} AND start_time='{TIME2}:00'""")
before2 = int(mq(f"SELECT COUNT(*) FROM schedule_slot WHERE competition_id={CID}") or 0)
r2 = api('POST', '/api/schedule/manual', {
    'competition_id': CID, 'band_id': BID, 'event_item_id': EID,
    'play_date': DATE2, 'start_time': TIME2, 'venue_id': VID2,
    'team_a_id': T1, 'team_b_id': T2, 'stage': 1
})
print('  返回:', r2)
check('空格子可新增比赛', r2.get('code') == 0, r2.get('message', ''))
if r2.get('code') == 0:
    after2 = int(mq(f"SELECT COUNT(*) FROM schedule_slot WHERE competition_id={CID}") or 0)
    check('自动新建了时间槽', after2 == before2 + 1, f'{before2} → {after2}')
    check('比赛落在新槽上', str(mq(f"SELECT slot_id FROM match_info WHERE id={r2['data']['id']}")) == str(r2['data']['slot_id']))
    api('DELETE', f"/api/schedule/match/{r2['data']['id']}")
    mq(f"DELETE FROM schedule_slot WHERE competition_id={CID} AND play_date='{DATE2}' AND venue_id={VID2} AND start_time='{TIME2}:00'")
    check('已清理测试场次与新建槽',
          int(mq(f"SELECT COUNT(*) FROM schedule_slot WHERE competition_id={CID}") or 0) == before2)

print('\n== 场景3：占位槽应被拒绝 ==')
blk = mq(f"""SELECT ss.id, ss.play_date, TIME_FORMAT(ss.start_time,'%H:%i'), ss.venue_id, ss.occupation
FROM schedule_slot ss WHERE ss.competition_id={CID} AND ss.slot_type=2 LIMIT 1""")
if '|' in blk:
    _, BD, BT, BV, OCC = blk.split('|')
    r3 = api('POST', '/api/schedule/manual', {
        'competition_id': CID, 'band_id': BID, 'event_item_id': EID,
        'play_date': BD, 'start_time': BT, 'venue_id': int(BV),
        'team_a_id': T1, 'team_b_id': T2, 'stage': 1
    })
    check('占位时段被拒绝', r3.get('code') != 0, r3.get('message', ''))
else:
    print('  （库里没有占位槽，跳过）')

print('\n== 场景4：该时段已有比赛应被拒绝 ==')
occ = mq(f"""SELECT ss.play_date, TIME_FORMAT(ss.start_time,'%H:%i'), ss.venue_id, m.id
FROM match_info m JOIN schedule_slot ss ON ss.id=m.slot_id
WHERE m.competition_id={CID} LIMIT 1""")
if '|' in occ:
    OD, OT, OV, MID = occ.split('|')
    r4 = api('POST', '/api/schedule/manual', {
        'competition_id': CID, 'band_id': BID, 'event_item_id': EID,
        'play_date': OD, 'start_time': OT, 'venue_id': int(OV),
        'team_a_id': T1, 'team_b_id': T2, 'stage': 1
    })
    check('已占用时段被拒绝', r4.get('code') != 0, r4.get('message', ''))
else:
    print('  （库里没有已排期比赛，跳过）')

mq(f"UPDATE event_item SET home_away=0 WHERE id={EID}")
print(f'\n===== 通过 {len(PASS)} / 失败 {len(FAIL)} =====')
if FAIL:
    print('失败项:', FAIL)
