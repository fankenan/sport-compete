# -*- coding: utf-8 -*-
"""第五期端到端实测：日程编排 / 秩序册 / 奖状 / 改期与锁"""
import os
import json
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
    return o or e


PASS, FAIL = [], []


def check(name, cond, detail=''):
    if cond:
        PASS.append(name); print(f'  [OK] {name} {detail}')
    else:
        FAIL.append(name); print(f'  [!!] {name} {detail}')


print('\n===== 0. 造测试数据 =====')
setup = """
DELETE FROM timetable_conflict WHERE competition_id IN (SELECT id FROM competition WHERE name='P5测试赛');
DELETE FROM timetable_item WHERE competition_id IN (SELECT id FROM competition WHERE name='P5测试赛');
DELETE FROM schedule_unit WHERE competition_id IN (SELECT id FROM competition WHERE name='P5测试赛');
DELETE FROM order_book WHERE competition_id IN (SELECT id FROM competition WHERE name='P5测试赛');
DELETE FROM certificate_record WHERE competition_id IN (SELECT id FROM competition WHERE name='P5测试赛');
DELETE FROM certificate_template WHERE competition_id IN (SELECT id FROM competition WHERE name='P5测试赛');
DELETE FROM meet_flow_node WHERE competition_id IN (SELECT id FROM competition WHERE name='P5测试赛');
DELETE FROM meet_reschedule_log WHERE competition_id IN (SELECT id FROM competition WHERE name='P5测试赛');
DELETE FROM meet_lock_log WHERE competition_id IN (SELECT id FROM competition WHERE name='P5测试赛');
DELETE FROM team_score_item WHERE competition_id IN (SELECT id FROM competition WHERE name='P5测试赛');
DELETE FROM team_score_total WHERE competition_id IN (SELECT id FROM competition WHERE name='P5测试赛');
DELETE FROM team_score_rule WHERE competition_id IN (SELECT id FROM competition WHERE name='P5测试赛');
DELETE FROM field_attempt WHERE heat_entry_id NOT IN (SELECT id FROM heat_entry);
DELETE FROM heat_entry WHERE competition_id IN (SELECT id FROM competition WHERE name='P5测试赛');
DELETE FROM track_heat WHERE competition_id IN (SELECT id FROM competition WHERE name='P5测试赛');
DELETE FROM arrangement_rule WHERE competition_id IN (SELECT id FROM competition WHERE name='P5测试赛');
DELETE FROM athlete_entry WHERE competition_id IN (SELECT id FROM competition WHERE name='P5测试赛');
DELETE FROM event_item WHERE competition_id IN (SELECT id FROM competition WHERE name='P5测试赛');
DELETE FROM group_band WHERE competition_id IN (SELECT id FROM competition WHERE name='P5测试赛');
DELETE FROM venue WHERE competition_id IN (SELECT id FROM competition WHERE name='P5测试赛');
DELETE FROM competition WHERE name='P5测试赛';
DELETE FROM athlete WHERE name LIKE 'P5-%';

INSERT INTO competition (name, year, status, start_date, end_date, minimum_rest_minutes)
VALUES ('P5测试赛', YEAR(CURDATE()), 1, CURDATE(), DATE_ADD(CURDATE(), INTERVAL 1 DAY), 30);
SET @cid = (SELECT id FROM competition WHERE name='P5测试赛');

INSERT INTO group_band (competition_id, stage, gender, group_type, label, sort_no)
VALUES (@cid, 1, 1, 'NORMAL', '初中男子', 1);
SET @bid = (SELECT id FROM group_band WHERE competition_id=@cid LIMIT 1);

INSERT INTO venue (competition_id, name, venue_no, sort_no) VALUES (@cid, '田径场', 1, 1);
INSERT INTO venue (competition_id, name, venue_no, sort_no) VALUES (@cid, '跳远沙坑', 2, 2);

INSERT INTO event_item (competition_id, name, category, event_type, result_entry_type,
  event_unit, is_higher_better, result_decimal_places, need_lane_order, sort_no, estimated_unit_minutes)
VALUES (@cid, '100米', 1, 'TRACK', 'TIME', '秒', 0, 2, 1, 1, 15);
SET @e1 = (SELECT id FROM event_item WHERE competition_id=@cid AND name='100米');
INSERT INTO event_item (competition_id, name, category, event_type, result_entry_type,
  event_unit, is_higher_better, result_decimal_places, need_lane_order, sort_no, estimated_unit_minutes)
VALUES (@cid, '跳远', 1, 'FIELD', 'DISTANCE', '米', 1, 2, 0, 2, 30);
SET @e2 = (SELECT id FROM event_item WHERE competition_id=@cid AND name='跳远');

INSERT INTO athlete (school_id, name, gender, class_name)
SELECT s.id, CONCAT('P5-', s.id, '-', seq.n), 1, '九年级1班'
FROM (SELECT 2 AS id UNION SELECT 3) s
CROSS JOIN (SELECT 1 AS n UNION SELECT 2 UNION SELECT 3 UNION SELECT 4) seq;

INSERT INTO athlete_entry (competition_id, band_id, athlete_id, event_item_id, status)
SELECT @cid, @bid, a.id, @e1, 2 FROM athlete a WHERE a.name LIKE 'P5-%';
INSERT INTO athlete_entry (competition_id, band_id, athlete_id, event_item_id, status)
SELECT @cid, @bid, a.id, @e2, 2 FROM athlete a WHERE a.name LIKE 'P5-%';

SELECT CONCAT(@cid,'|',@bid,'|',@e1,'|',@e2);
"""
o, e = run(f"""mysql -ucompete -pprocess.env.SPORT_DB_PASSWORD sport_compete -e "{setup}" 2>&1 | grep -v Warning""")
print(o or e)

ids = mq("""SELECT CONCAT(c.id,'|',b.id,'|',e1.id,'|',e2.id)
FROM competition c
JOIN group_band b ON b.competition_id=c.id
JOIN event_item e1 ON e1.competition_id=c.id AND e1.name='100米'
JOIN event_item e2 ON e2.competition_id=c.id AND e2.name='跳远'
WHERE c.name='P5测试赛';""")
CID, BID, E1, E2 = [int(x) for x in ids.split('|')]
print(f'赛事={CID} 组别={BID} 100米={E1} 跳远={E2}')

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
# 1. 编排赛次（为日程做准备）
# ============================================================
print('\n===== 1. 编排赛次 =====')
for eid, cap in [(E1, 4), (E2, 8)]:
    api('PUT', '/api/track-result/arrange-rule',
        {'competition_id': CID, 'event_item_id': eid, 'band_id': BID,
         'round_code': 'FINAL', 'round_mode': 'AUTO', 'lane_count': 8,
         'heat_capacity': cap, 'lane_order_mode': 'SNAKE'})
    r = api('POST', '/api/track-result/arrange', {'competition_id': CID, 'event_item_id': eid, 'band_id': BID, 'round_code': 'FINAL'})
    print(f'  项目{eid}编排:', json.dumps(r, ensure_ascii=False)[:120])

cnt = mq(f"SELECT COUNT(*) FROM track_heat WHERE competition_id={CID}")
print('  赛次数:', cnt)
check('赛次已编排', int(cnt or 0) >= 3, f'{cnt} 个赛次')

# ============================================================
# 2. 日程单元
# ============================================================
print('\n===== 2. 日程单元 =====')
r = api('POST', '/api/track-plan/units/generate', {'competition_id': CID, 'periods': ['AM', 'PM']})
print('  生成:', json.dumps(r, ensure_ascii=False)[:200])
check('按赛期生成单元', r.get('code') == 0, str(r.get('message', '')))

units = api('GET', f'/api/track-plan/units?competition_id={CID}').get('data') or []
print('  单元:', [(u['unit_date'], u['period'], u['name']) for u in units])
check('生成 4 个单元（2天×上下午）', len(units) == 4, f'{len(units)} 个')

r = api('POST', '/api/track-plan/units', {'competition_id': CID, 'unit_date': '2026-10-26', 'period': 'NIGHT',
                                           'name': '开幕式', 'start_time': '19:00:00', 'end_time': '21:00:00'})
check('手工加单元', r.get('code') == 0, str(r.get('message', '')))

# ============================================================
# 3. 自动排布 + 冲突检测
# ============================================================
print('\n===== 3. 自动排布 =====')
r = api('POST', '/api/track-plan/arrange', {'competition_id': CID, 'clear': True})
print('  排布:', json.dumps(r, ensure_ascii=False)[:250])
check('自动排布', r.get('code') == 0, str(r.get('message', '')))

items = api('GET', f'/api/track-plan/items?competition_id={CID}').get('data') or []
print('  日程条目:')
for it in items:
    print(f"   {it['unit_date']} {it['period']} {(it['start_time'] or '')[:5]} {(it['end_time'] or '')[:5]} {it['title']} @ {it['venue_name']} {it['estimated_minutes']}′")
check('赛次全部排入', len(items) >= 3, f'{len(items)} 条')

# 手工加一条非比赛项
r = api('POST', '/api/track-plan/item', {
    'competition_id': CID, 'unit_id': units[0]['id'] if units else None,
    'title': '开幕式', 'start_time': '08:30:00', 'estimated_minutes': 30
})
check('加非比赛项', r.get('code') == 0, str(r.get('message', '')))
MANUAL_ID = (r.get('data') or {}).get('id')

# 冲突检测
r = api('POST', '/api/track-plan/detect', {'competition_id': CID})
print('  冲突:', json.dumps(r, ensure_ascii=False)[:200])
conflicts = api('GET', f'/api/track-plan/conflicts?competition_id={CID}').get('data') or []
print('  冲突清单:')
for c in conflicts:
    print(f"   [{c['conflict_type']}] {c['detail']}")
check('冲突检测跑通', r.get('code') == 0, str(r.get('message', '')))

# 兼项冲突应该存在：8 人同时报 100米+跳远，若同场同段会撞
# 改时间触发冲突：把第1条挪到与最后一条（跳远）同单元同场地同时刻
if len(items) >= 2:
    t0, tLast = items[0], items[-1]
    r = api('PUT', f"/api/track-plan/item/{t0['id']}", {
        'unit_id': tLast['unit_id'], 'venue_id': tLast['venue_id'],
        'start_time': tLast['start_time'],
        'estimated_minutes': t0['estimated_minutes']
    })
    check('拖拽改时间', r.get('code') == 0, str(r.get('message', '')))
    conflicts2 = api('GET', f'/api/track-plan/conflicts?competition_id={CID}').get('data') or []
    hasVenue = any(c['conflict_type'] == 'VENUE' for c in conflicts2)
    hasAthlete = any(c['conflict_type'] in ('ATHLETE', 'REST') for c in conflicts2)
    print('  主动制造冲突后:', [(c['conflict_type'], c['detail'][:40]) for c in conflicts2])
    check('重叠改时间触发场地冲突', hasVenue, f"{len(conflicts2)} 处冲突")
    check('兼项冲突被识别', hasAthlete, '')
    if conflicts2:
        r = api('POST', f"/api/track-plan/conflicts/{conflicts2[0]['id']}/resolve")
        check('冲突标记处理', r.get('code') == 0, str(r.get('message', '')))
    # 改回，消除冲突
    api('PUT', f"/api/track-plan/item/{t0['id']}", {
        'unit_id': t0['unit_id'], 'venue_id': t0['venue_id'],
        'start_time': t0['start_time'], 'estimated_minutes': t0['estimated_minutes']
    })

# 锁定条目
if items:
    t1 = items[-1]
    r = api('PUT', f"/api/track-plan/item/{t1['id']}", {'locked_flag': 1})
    check('锁定条目', r.get('code') == 0, str(r.get('message', '')))
    lk = mq(f"SELECT locked_flag FROM timetable_item WHERE id={t1['id']}")
    check('锁定落库', lk.strip() == '1', lk)

# 删掉手工项
if MANUAL_ID:
    r = api('DELETE', f'/api/track-plan/item/{MANUAL_ID}')
    check('删除条目', r.get('code') == 0, str(r.get('message', '')))

# ============================================================
# 4. 秩序册
# ============================================================
print('\n===== 4. 秩序册 =====')
b = api('GET', f'/api/track-plan/order-book?competition_id={CID}').get('data') or {}
check('默认章节', len(b.get('sections_json') or []) == 9, f"{len(b.get('sections_json') or [])} 章")

b['sections_json'][7]['enabled'] = 0  # 关掉「注意事项」
r = api('PUT', '/api/track-plan/order-book', {
    'competition_id': CID, 'title': 'P5测试赛秩序册',
    'subtitle': '2026年秋季', 'cover_note': '本秩序册仅供内部使用',
    'sections_json': b['sections_json']
})
check('保存章节编排', r.get('code') == 0, str(r.get('message', '')))

d = api('GET', f'/api/track-plan/order-book/data?competition_id={CID}').get('data') or {}
print('  章节数据: 单位', len(d.get('schools') or []), '| 运动员', len(d.get('athletes') or []),
      '| 日程', len(d.get('timetable') or []), '| 赛次', len(d.get('heats') or []))
check('取到秩序册数据', len(d.get('athletes') or []) > 0, f"{len(d.get('athletes') or [])} 人")
check('分组名单带运动员', any(len(h.get('entries') or []) > 0 for h in (d.get('heats') or [])), '')

r = api('POST', '/api/track-plan/order-book/generate', {'competition_id': CID})
check('生成秩序册', r.get('code') == 0, str(r.get('message', '')))
st = mq(f"SELECT status FROM order_book WHERE competition_id={CID}")
check('生成状态落库', st.strip() == '1', st)

# ============================================================
# 5. 奖状
# ============================================================
print('\n===== 5. 奖状 =====')
# 先录成绩确认，给奖状提供名次
items5 = api('GET', f'/api/track-plan/items?competition_id={CID}').get('data') or []
for it in items5:
    if not it.get('heat_id'):
        continue
    hd = api('GET', f"/api/track-result/heat/{it['heat_id']}")
    ents = (hd.get('data') or {}).get('entries') or []
    if not ents:
        continue
    isTrack = '100米' in (it.get('event_name') or '')
    vals = (['11.5', '11.8', '12.0', '12.3'] if isTrack else ['5.9', '5.6', '5.3', '5.0'])
    payload = []
    for i, ent in enumerate(ents):
        v = vals[i % len(vals)] if i < len(vals) else None
        payload.append({'id': ent['id'], 'result_text': v} if v else {'id': ent['id'], 'status_code': 'NM'})
    api('POST', '/api/track-result/save', {'heat_id': it['heat_id'], 'entries': payload})
    api('POST', '/api/track-result/confirm', {'heat_id': it['heat_id']})
print('  成绩已录入确认')

r = api('POST', '/api/track-plan/cert-templates', {
    'competition_id': CID, 'name': '个人优胜奖', 'template_type': 'INDIVIDUAL',
    'page_size': 'A4', 'orientation': 'landscape'
})
print('  建模板:', json.dumps(r, ensure_ascii=False)[:200])
check('建奖状模板', r.get('code') == 0, str(r.get('message', '')))
TPL = (r.get('data') or {}).get('id')

r = api('POST', '/api/track-plan/cert/generate', {
    'competition_id': CID, 'template_id': TPL, 'rank_limit': 3, 'source': 'INDIVIDUAL'
})
print('  生成:', json.dumps(r, ensure_ascii=False)[:200])
check('批量生成奖状', r.get('code') == 0, str(r.get('message', '')))

recs = api('GET', f'/api/track-plan/cert-records?competition_id={CID}&template_id={TPL}').get('data') or []
print('  奖状:')
for x in recs:
    print(f"   第{x['rank_no']}名 {x['winner_name']}（{x['winner_school']}）{x['award_name']}")
check('奖状有记录', len(recs) >= 3, f'{len(recs)} 张')

# 团体奖状
api('POST', '/api/track-stats/team-score-rules', {
    'competition_id': CID, 'scheme_name': 'P5团体', 'scope_mode': 'BAND',
    'band_ids': [BID], 'score_source': 'RANK', 'rank_limit': 3
})
RULE = mq(f"SELECT id FROM team_score_rule WHERE competition_id={CID} LIMIT 1").strip()
api('POST', '/api/track-stats/team-score/calc', {'competition_id': CID, 'rule_id': int(RULE)})
r = api('POST', '/api/track-plan/cert/generate', {
    'competition_id': CID, 'template_id': TPL, 'rank_limit': 2, 'source': 'TEAM'
})
print('  团体奖状:', json.dumps(r, ensure_ascii=False)[:150])
check('团体奖状生成', r.get('code') == 0, str(r.get('message', '')))

r = api('POST', '/api/track-plan/cert-records/printed', {'competition_id': CID, 'template_id': TPL})
check('标记已打印', r.get('code') == 0, str(r.get('message', '')))
pf = mq(f"SELECT COUNT(*) FROM certificate_record WHERE competition_id={CID} AND printed_flag=1")
check('打印标记落库', int(pf or 0) > 0, f'{pf} 张已标记')

# ============================================================
# 6. 改期与锁
# ============================================================
print('\n===== 6. 改期与锁 =====')
r = api('POST', '/api/track-plan/reschedule', {'competition_id': CID, 'shift_days': 2, 'reason': 'P5测试改期'})
print('  改期:', json.dumps(r, ensure_ascii=False)[:250])
check('整体改期', r.get('code') == 0, str(r.get('message', '')))

nd = mq(f"SELECT start_date, end_date FROM competition WHERE id={CID}")
print('  改期后赛事日期:', nd.replace('\t', ' ~ '))
old = mq(f"SELECT old_start_date, new_start_date FROM meet_reschedule_log WHERE competition_id={CID} ORDER BY id DESC LIMIT 1")
print('  日志:', old.replace('\t', ' -> '))
check('改期日志', 'old_start_date' not in old and '\t' in old, old)
u2 = api('GET', f'/api/track-plan/units?competition_id={CID}').get('data') or []
print('  改期后单元日期:', sorted(set(str(u['unit_date']) for u in u2)))
check('单元日期平移了 2 天', bool(u2) and str(u2[0]['unit_date']) > '2026-10-27', str(u2[0]['unit_date'] if u2 else None))

r = api('POST', '/api/track-plan/reschedule', {'competition_id': CID, 'shift_days': -2, 'reason': '改回去'})
check('改回原日期', r.get('code') == 0, str(r.get('message', '')))

# 四把锁
r = api('PUT', '/api/track-plan/locks', {'competition_id': CID, 'lock_type': 'TIMETABLE', 'action': 'LOCK'})
check('日程上锁', r.get('code') == 0, str(r.get('message', '')))
lk = api('GET', f'/api/track-plan/locks?competition_id={CID}').get('data') or {}
check('锁状态回读', str(lk.get('timetable_lock_flag')) in ('1','1.0'),
      f"timetable_lock={lk.get('timetable_lock_flag')}")

# 锁上后改日程应被拒绝
if items:
    r = api('PUT', f"/api/track-plan/item/{items[0]['id']}", {'start_time': '10:00:00'})
    check('锁上后禁止改日程', r.get('code') != 0 and '锁定' in str(r.get('message', '')),
          str(r.get('message', ''))[:60])

r = api('PUT', '/api/track-plan/locks', {'competition_id': CID, 'lock_type': 'TIMETABLE', 'action': 'UNLOCK'})
check('日程解锁', r.get('code') == 0, str(r.get('message', '')))
r = api('PUT', f"/api/track-plan/item/{items[0]['id']}", {'start_time': items[0]['start_time']})
check('解锁后可改', r.get('code') == 0, str(r.get('message', '')))

ll = api('GET', f'/api/track-plan/lock-logs?competition_id={CID}').get('data') or []
check('锁操作日志', len(ll) >= 2, f'{len(ll)} 条')

# 流程节点
r = api('POST', '/api/track-plan/flow-nodes/init', {'competition_id': CID})
print('  初始化:', json.dumps(r, ensure_ascii=False)[:150])
check('初始化流程节点', r.get('code') == 0, str(r.get('message', '')))

nodes = api('GET', f'/api/track-plan/flow-nodes?competition_id={CID}').get('data') or []
print('  节点:', [(n['node_name'], n['done_flag']) for n in nodes])
check('6 个流程节点', len(nodes) == 6, f'{len(nodes)} 个')

if nodes:
    r = api('PUT', f"/api/track-plan/flow-nodes/{nodes[0]['id']}", {'done_flag': 1, 'plan_date': '2026-10-26'})
    check('节点标记完成', r.get('code') == 0, str(r.get('message', '')))
    n0 = api('GET', f'/api/track-plan/flow-nodes?competition_id={CID}').get('data')[0]
    check('完成状态落库', int(n0['done_flag']) == 1 and n0['done_at'], f"done={n0['done_flag']} at={n0['done_at']}")

# ============================================================
# 7. 清理
# ============================================================
print('\n===== 7. 清理 =====')
clean = """
DELETE FROM timetable_conflict WHERE competition_id IN (SELECT id FROM competition WHERE name='P5测试赛');
DELETE FROM timetable_item WHERE competition_id IN (SELECT id FROM competition WHERE name='P5测试赛');
DELETE FROM schedule_unit WHERE competition_id IN (SELECT id FROM competition WHERE name='P5测试赛');
DELETE FROM order_book WHERE competition_id IN (SELECT id FROM competition WHERE name='P5测试赛');
DELETE FROM certificate_record WHERE competition_id IN (SELECT id FROM competition WHERE name='P5测试赛');
DELETE FROM certificate_template WHERE competition_id IN (SELECT id FROM competition WHERE name='P5测试赛');
DELETE FROM meet_flow_node WHERE competition_id IN (SELECT id FROM competition WHERE name='P5测试赛');
DELETE FROM meet_reschedule_log WHERE competition_id IN (SELECT id FROM competition WHERE name='P5测试赛');
DELETE FROM meet_lock_log WHERE competition_id IN (SELECT id FROM competition WHERE name='P5测试赛');
DELETE FROM team_score_item WHERE competition_id IN (SELECT id FROM competition WHERE name='P5测试赛');
DELETE FROM team_score_total WHERE competition_id IN (SELECT id FROM competition WHERE name='P5测试赛');
DELETE FROM team_score_rule WHERE competition_id IN (SELECT id FROM competition WHERE name='P5测试赛');
DELETE FROM field_attempt WHERE heat_entry_id NOT IN (SELECT id FROM heat_entry);
DELETE FROM heat_entry WHERE competition_id IN (SELECT id FROM competition WHERE name='P5测试赛');
DELETE FROM track_heat WHERE competition_id IN (SELECT id FROM competition WHERE name='P5测试赛');
DELETE FROM arrangement_rule WHERE competition_id IN (SELECT id FROM competition WHERE name='P5测试赛');
DELETE FROM athlete_entry WHERE competition_id IN (SELECT id FROM competition WHERE name='P5测试赛');
DELETE FROM event_item WHERE competition_id IN (SELECT id FROM competition WHERE name='P5测试赛');
DELETE FROM group_band WHERE competition_id IN (SELECT id FROM competition WHERE name='P5测试赛');
DELETE FROM venue WHERE competition_id IN (SELECT id FROM competition WHERE name='P5测试赛');
DELETE FROM competition WHERE name='P5测试赛';
DELETE FROM athlete WHERE name LIKE 'P5-%';
SELECT 'cleaned';
"""
o, e = run(f"""mysql -ucompete -pprocess.env.SPORT_DB_PASSWORD sport_compete -e "{clean}" 2>&1 | grep -v Warning""")
print(o or e)

print('\n================ 汇总 ================')
print(f'通过 {len(PASS)} 项，失败 {len(FAIL)} 项')
if FAIL:
    print('失败项:', FAIL)
cli.close()
