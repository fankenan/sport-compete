# -*- coding: utf-8 -*-
"""第四期端到端实测：团体总分 / 达级 / 破纪录 / 综合查询 / 公开页 / 大屏控制"""
import os
import json
import paramiko

HOST, USER, PWD = '10.128.1.45', 'single', 'jyj2026'
cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(HOST, 22, USER, PWD, timeout=15)


def run(cmd, t=180):
    _, o, e = cli.exec_command(cmd, timeout=t)
    return o.read().decode('utf-8', 'replace').strip(), e.read().decode('utf-8', 'replace').strip()


def mq(sql):
    o, e = run(f"""mysql -ucompete -p'Compete@2026' sport_compete -N -e "{sql}" 2>&1 | grep -v Warning""")
    return o or e


PASS, FAIL = [], []


def check(name, cond, detail=''):
    if cond:
        PASS.append(name); print(f'  [OK] {name} {detail}')
    else:
        FAIL.append(name); print(f'  [!!] {name} {detail}')


# ============================================================
# 0. 造测试数据
# ============================================================
print('\n===== 0. 造测试数据 =====')
setup = """
DELETE FROM team_score_item WHERE competition_id IN (SELECT id FROM competition WHERE name='P4测试赛');
DELETE FROM team_score_total WHERE competition_id IN (SELECT id FROM competition WHERE name='P4测试赛');
DELETE FROM virtual_group WHERE competition_id IN (SELECT id FROM competition WHERE name='P4测试赛');
DELETE FROM team_score_rule WHERE competition_id IN (SELECT id FROM competition WHERE name='P4测试赛');
DELETE FROM screen_config WHERE competition_id IN (SELECT id FROM competition WHERE name='P4测试赛');
DELETE FROM grade_achievement WHERE competition_id IN (SELECT id FROM competition WHERE name='P4测试赛');
DELETE FROM record_break WHERE competition_id IN (SELECT id FROM competition WHERE name='P4测试赛');
DELETE FROM meet_record WHERE competition_id IN (SELECT id FROM competition WHERE name='P4测试赛');
DELETE FROM meet_grade_bonus_rule WHERE competition_id IN (SELECT id FROM competition WHERE name='P4测试赛');
DELETE FROM meet_record_bonus_rule WHERE competition_id IN (SELECT id FROM competition WHERE name='P4测试赛');
DELETE FROM grade_standard_threshold WHERE standard_id IN (SELECT id FROM grade_standard WHERE standard_code='P4TEST');
DELETE FROM grade_standard WHERE standard_code='P4TEST';
DELETE FROM field_attempt WHERE heat_entry_id NOT IN (SELECT id FROM heat_entry);
DELETE FROM heat_entry WHERE competition_id IN (SELECT id FROM competition WHERE name='P4测试赛');
DELETE FROM track_heat WHERE competition_id IN (SELECT id FROM competition WHERE name='P4测试赛');
DELETE FROM arrangement_rule WHERE competition_id IN (SELECT id FROM competition WHERE name='P4测试赛');
DELETE FROM athlete_entry WHERE competition_id IN (SELECT id FROM competition WHERE name='P4测试赛');
DELETE FROM event_item WHERE competition_id IN (SELECT id FROM competition WHERE name='P4测试赛');
DELETE FROM group_band WHERE competition_id IN (SELECT id FROM competition WHERE name='P4测试赛');
DELETE FROM competition WHERE name='P4测试赛';
DELETE FROM athlete WHERE name LIKE 'P4-%';

INSERT INTO competition (name, year, status, start_date, end_date)
VALUES ('P4测试赛', YEAR(CURDATE()), 1, CURDATE(), CURDATE());
SET @cid = (SELECT id FROM competition WHERE name='P4测试赛');

INSERT INTO group_band (competition_id, stage, gender, group_type, label, sort_no)
VALUES (@cid, 1, 1, 'NORMAL', '初中男子', 1);
SET @bid = (SELECT id FROM group_band WHERE competition_id=@cid LIMIT 1);

-- 100米（越小越好）+ 跳远（越大越好）
INSERT INTO event_item (competition_id, name, category, event_type, result_entry_type,
  event_unit, is_higher_better, result_decimal_places, need_lane_order, sort_no)
VALUES (@cid, '100米', 1, 'TRACK', 'TIME', '秒', 0, 2, 1, 1);
SET @e1 = (SELECT id FROM event_item WHERE competition_id=@cid AND name='100米');

INSERT INTO event_item (competition_id, name, category, event_type, result_entry_type,
  event_unit, is_higher_better, result_decimal_places, need_lane_order, sort_no)
VALUES (@cid, '跳远', 1, 'FIELD', 'DISTANCE', '米', 1, 2, 0, 2);
SET @e2 = (SELECT id FROM event_item WHERE competition_id=@cid AND name='跳远');

-- 3 所学校各 3 人 = 9 人
INSERT INTO athlete (school_id, name, gender, class_name)
SELECT s.id, CONCAT('P4-', s.id, '-', seq.n), 1, '九年级1班'
FROM (SELECT 2 AS id UNION SELECT 3 UNION SELECT 6) s
CROSS JOIN (SELECT 1 AS n UNION SELECT 2 UNION SELECT 3) seq;

INSERT INTO athlete_entry (competition_id, band_id, athlete_id, event_item_id, status)
SELECT @cid, @bid, a.id, @e1, 2 FROM athlete a WHERE a.name LIKE 'P4-%';
INSERT INTO athlete_entry (competition_id, band_id, athlete_id, event_item_id, status)
SELECT @cid, @bid, a.id, @e2, 2 FROM athlete a WHERE a.name LIKE 'P4-%';

SELECT CONCAT(@cid,'|',@bid,'|',@e1,'|',@e2);
"""
o, e = run(f"""mysql -ucompete -p'Compete@2026' sport_compete -e "{setup}" 2>&1 | grep -v Warning""")
print(o or e)

ids = mq("""SELECT CONCAT(c.id,'|',b.id,'|',e1.id,'|',e2.id)
FROM competition c
JOIN group_band b ON b.competition_id=c.id
JOIN event_item e1 ON e1.competition_id=c.id AND e1.name='100米'
JOIN event_item e2 ON e2.competition_id=c.id AND e2.name='跳远'
WHERE c.name='P4测试赛';""")
CID, BID, E1, E2 = [int(x) for x in ids.split('|')]
print(f'赛事={CID} 组别={BID} 100米={E1} 跳远={E2}')

# 签 token
o, e = run("""cd /home/single/sport-compete/server && set -a && . ./.env && set +a && node -e "
const jwt=require('jsonwebtoken');
console.log(jwt.sign({id:1,username:'admin',role:1,real_name:'管理员'}, process.env.JWT_SECRET, {expiresIn:'2h'}));
" """)
TOKEN = (o or e).strip().split('\n')[-1]


def api(method, path, body=None, auth=True):
    hdr = f'-H "Authorization: Bearer {TOKEN}"' if auth else ''
    if body is None:
        cmd = f"""curl -s -X {method} {hdr} -H "Content-Type: application/json" "http://127.0.0.1:4100{path}\""""
    else:
        js = json.dumps(body, ensure_ascii=False).replace('"', '\\"')
        cmd = f"""curl -s -X {method} {hdr} -H "Content-Type: application/json" -d "{js}" "http://127.0.0.1:4100{path}\""""
    o, e = run(cmd)
    try:
        return json.loads(o)
    except Exception:
        return {'raw': o[:300], 'err': e[:200]}


# ============================================================
# 1. 编排 + 录成绩 + 确认
# ============================================================
print('\n===== 1. 编排并录入成绩 =====')
api('PUT', '/api/track-result/arrange-rule',
    {'competition_id': CID, 'event_item_id': E1, 'band_id': BID,
     'round_code': 'FINAL', 'round_mode': 'AUTO', 'lane_count': 8,
     'heat_capacity': 9, 'lane_order_mode': 'SNAKE'})
r = api('POST', '/api/track-result/arrange', {'competition_id': CID, 'event_item_id': E1, 'band_id': BID, 'round_code': 'FINAL'})
print('  100米编排:', json.dumps(r, ensure_ascii=False)[:150])
check('100米编排', r.get('code') == 0 or r.get('message'), '')

api('PUT', '/api/track-result/arrange-rule',
    {'competition_id': CID, 'event_item_id': E2, 'band_id': BID,
     'round_code': 'FINAL', 'round_mode': 'AUTO', 'lane_count': 8,
     'heat_capacity': 9, 'lane_order_mode': 'SNAKE'})
r = api('POST', '/api/track-result/arrange', {'competition_id': CID, 'event_item_id': E2, 'band_id': BID, 'round_code': 'FINAL'})
print('  跳远编排:', json.dumps(r, ensure_ascii=False)[:150])
check('跳远编排', r.get('code') == 0 or r.get('message'), '')

wb = api('GET', f'/api/track-result/workbench?competition_id={CID}&event_item_id={E1}&band_id={BID}')
heats = wb.get('data') or []
H1 = heats[0].get('id') if heats else None
hd = api('GET', f'/api/track-result/heat/{H1}')
ents = (hd.get('data') or {}).get('entries') or []
print('  100米第1组:', [(e.get('id'), e.get('athlete_name'), e.get('school_name')) for e in ents])

# 录入成绩（秒）：按名次顺序给 9 人，最后一人 DNS
results = ['12.10', '12.50', '13.00', '11.80', '12.90', '13.40', '11.50', '12.70', None]
payload = []
for i, ent in enumerate(ents):
    v = results[i] if i < len(results) else None
    if v is None:
        payload.append({'id': ent.get('id'), 'status_code': 'DNS'})
    else:
        payload.append({'id': ent.get('id'), 'result_text': v})
r = api('POST', '/api/track-result/save', {'heat_id': H1, 'entries': payload})
print('  100米保存:', json.dumps(r, ensure_ascii=False)[:150])
r = api('POST', '/api/track-result/confirm', {'heat_id': H1})
print('  确认:', json.dumps(r, ensure_ascii=False)[:150])
check('成绩确认', r.get('code') == 0, str(r.get('message', '')))

# 跳远录成绩
wb2 = api('GET', f'/api/track-result/workbench?competition_id={CID}&event_item_id={E2}&band_id={BID}')
h2 = (wb2.get('data') or [{}])[0].get('id')
hd2 = api('GET', f'/api/track-result/heat/{h2}')
ents2 = (hd2.get('data') or {}).get('entries') or []
lj = ['5.20', '5.80', '6.10', '5.50', '6.30', '5.90', '4.80', '5.60', None]
payload2 = []
for i, ent in enumerate(ents2):
    v = lj[i] if i < len(lj) else None
    if v is None:
        payload2.append({'id': ent.get('id'), 'status_code': 'NM'})
    else:
        payload2.append({'id': ent.get('id'), 'result_text': v})
r = api('POST', '/api/track-result/save', {'heat_id': h2, 'entries': payload2})
print('  跳远保存:', json.dumps(r, ensure_ascii=False)[:150])
r = api('POST', '/api/track-result/confirm', {'heat_id': h2})
print('  跳远确认:', json.dumps(r, ensure_ascii=False)[:150])

# 校验成绩真的落库了
cnt = mq(f"SELECT COUNT(*) FROM heat_entry WHERE heat_id={H1} AND result_value IS NOT NULL")
print('  100米有效成绩条数:', cnt)
check('成绩落库', int(cnt or 0) == 8, f'{cnt} 条（应为 8，1 人 DNS）')
top = mq(f"SELECT rank_no, result_text FROM heat_entry WHERE heat_id={H1} ORDER BY rank_no LIMIT 3")
print('  前三名:', top.replace('\n', ' | '))
check('名次已算出', '11.50' in top, top.replace('\n', ' '))

# ============================================================
# 2. 团体总分
# ============================================================
print('\n===== 2. 团体总分 =====')
r = api('POST', '/api/track-stats/team-score-rules', {
    'competition_id': CID, 'scheme_name': '按组团体总分', 'scope_mode': 'BAND',
    'band_ids': [BID], 'score_source': 'RANK',
    'score_table': {1: 9, 2: 7, 3: 6, 4: 5, 5: 4, 6: 3, 7: 2, 8: 1},
    'rank_limit': 8, 'relay_multiplier': 2,
    'include_grade_bonus': 0, 'include_record_bonus': 0, 'tie_break_mode': 'FIRST'
})
print('  建方案:', json.dumps(r, ensure_ascii=False)[:200])
check('建团体总分方案', r.get('code') == 0, str(r.get('message', '')))
RULE1 = (r.get('data') or {}).get('id')
check('方案返回 id', RULE1 is not None, f'id={RULE1}')

r = api('POST', '/api/track-stats/team-score/calc', {'competition_id': CID, 'rule_id': RULE1})
print('  计算:', json.dumps(r, ensure_ascii=False)[:200])
check('团体总分计算', r.get('code') == 0, str(r.get('message', '')))

rows = api('GET', f'/api/track-stats/team-score/total?rule_id={RULE1}').get('data') or []
print('  排名结果:')
for x in rows:
    print(f"   第{x['rank_no']}名 {x['unit_name']} 项目分={x['total_score']} 总分={x['final_score']} 第一={x['first_count']} 第二={x['second_count']} 第三={x['third_count']}")
check('团体总分有结果', len(rows) == 3, f'{len(rows)} 个单位')
if len(rows) >= 2:
    check('名次递减', rows[0]['rank_no'] == 1 and rows[0]['final_score'] >= rows[1]['final_score'],
          f"{rows[0]['final_score']} >= {rows[1]['final_score']}")

# 基础分调整
if rows:
    tgt = rows[-1]
    r = api('PUT', '/api/track-stats/team-score/adjust',
            {'id': tgt['id'], 'adjust_score': 5, 'adjust_reason': '奖励加分'})
    check('基础分调整', r.get('code') == 0, str(r.get('message', '')))
    after = api('GET', f'/api/track-stats/team-score/total?rule_id={RULE1}').get('data') or []
    a = [x for x in after if x['id'] == tgt['id']][0]
    check('调整后总分+5', abs(float(a['final_score']) - (float(tgt['final_score']) + 5)) < 0.01,
          f"{tgt['final_score']} -> {a['final_score']}")
    check('调整原因落库', a.get('adjust_reason') == '奖励加分', str(a.get('adjust_reason')))

# 虚拟组方案
r = api('POST', '/api/track-stats/team-score-rules', {
    'competition_id': CID, 'scheme_name': '虚拟组方案', 'scope_mode': 'VIRTUAL',
    'band_ids': [BID], 'score_source': 'RANK', 'rank_limit': 8
})
RULE2 = (r.get('data') or {}).get('id')
r = api('POST', '/api/track-stats/virtual-groups', {
    'competition_id': CID, 'rule_id': RULE2, 'group_name': '市区联队', 'school_ids': [2, 3]
})
print('  建虚拟组:', json.dumps(r, ensure_ascii=False)[:150])
check('建虚拟组', r.get('code') == 0, str(r.get('message', '')))
r = api('POST', '/api/track-stats/team-score/calc', {'competition_id': CID, 'rule_id': RULE2})
rows2 = api('GET', f'/api/track-stats/team-score/total?rule_id={RULE2}').get('data') or []
print('  虚拟组排名:', [(x['unit_name'], x['final_score']) for x in rows2])
check('虚拟组生效', any(x['unit_type'] == 'VIRTUAL' for x in rows2),
      str([x['unit_name'] for x in rows2]))
check('虚拟组合并了两校分数', len(rows2) == 2, f'{len(rows2)} 个单位（联队 + 另一校）')

# 明细
det = api('GET', f'/api/track-stats/team-score/detail?rule_id={RULE1}').get('data') or []
print('  明细条数:', len(det))
if det:
    print('  样本:', [(d.get('athlete_name'), d.get('rank_no'), d.get('base_score')) for d in det[:4]])
check('得分明细可追溯', len(det) > 0, f'{len(det)} 条')

# ============================================================
# 3. 达级
# ============================================================
print('\n===== 3. 达级认定 =====')
r = api('POST', '/api/track-stats/grade-standards', {
    'standard_code': 'P4TEST', 'event_name': '男子100米', 'specification': '100米',
    'gender': 'M', 'result_unit': '秒', 'result_direction': 'LOWER', 'result_entry_type': 'TIME'
})
STD = (r.get('data') or {}).get('id')
print('  建标准:', json.dumps(r, ensure_ascii=False)[:150])
check('建等级标准', STD is not None, f'id={STD}')

r = api('PUT', '/api/track-stats/grade-thresholds', {
    'standard_id': STD,
    'rows': [
        {'grade_code': 'L2', 'grade_name': '二级运动员', 'result_value': 11.90, 'bonus_value': 5, 'sort_no': 1},
        {'grade_code': 'L3', 'grade_name': '三级运动员', 'result_value': 12.60, 'bonus_value': 3, 'sort_no': 2}
    ]
})
print('  阈值:', json.dumps(r, ensure_ascii=False)[:150])
check('保存达标阈值', r.get('code') == 0, str(r.get('message', '')))

r = api('PUT', f'/api/track-stats/event/{E1}/grade-standard', {'grade_standard_id': STD})
check('项目绑定等级标准', r.get('code') == 0, str(r.get('message', '')))

r = api('POST', '/api/track-stats/grade/recognize', {'competition_id': CID})
print('  认定:', json.dumps(r, ensure_ascii=False)[:250])
check('批量达级认定', r.get('code') == 0, str(r.get('message', '')))

achs = api('GET', f'/api/track-stats/grade-achievements?competition_id={CID}').get('data') or []
print('  达级名单:')
for a in achs:
    print(f"   {a['athlete_name']} {a['event_name']} {a['result_text']} → {a['grade_name']} (+{a['bonus_value']})")
check('有达级记录', len(achs) > 0, f'{len(achs)} 条')
# 11.50/11.80 应达二级；12.10/12.50 应达三级；13.00 及以上不达
l2 = [a for a in achs if a['grade_code'] == 'L2']
l3 = [a for a in achs if a['grade_code'] == 'L3']
check('11.50/11.80 达二级', len(l2) == 2, f'{len(l2)} 人: {[a["result_text"] for a in l2]}')
check('12.10/12.50 达三级', len(l3) == 2, f'{len(l3)} 人: {[a["result_text"] for a in l3]}')
check('13.00 及以上不达级', len(achs) == 4, f'共 {len(achs)} 条')

r = api('PUT', '/api/track-stats/grade-bonus-rules', {
    'competition_id': CID,
    'rows': [{'grade_code': 'L2', 'grade_name': '二级运动员', 'bonus_value': 8},
             {'grade_code': 'L3', 'grade_name': '三级运动员', 'bonus_value': 4}]
})
check('达级加分规则保存', r.get('code') == 0, str(r.get('message', '')))

sm = api('GET', f'/api/track-stats/grade/summary?competition_id={CID}').get('data') or {}
print('  按等级:', [(g['grade_name'], g['c']) for g in (sm.get('byGrade') or [])])
print('  按单位:', [(s['team_name'], s['c'], s['bonus_total']) for s in (sm.get('bySchool') or [])])
check('达级汇总', len(sm.get('byGrade') or []) > 0, '')

# 达级计入团体总分
r = api('POST', '/api/track-stats/team-score-rules', {
    'id': RULE1, 'competition_id': CID, 'scheme_name': '按组团体总分',
    'scope_mode': 'BAND', 'band_ids': [BID], 'score_source': 'RANK',
    'score_table': {1: 9, 2: 7, 3: 6, 4: 5, 5: 4, 6: 3, 7: 2, 8: 1},
    'rank_limit': 8, 'include_grade_bonus': 1, 'include_record_bonus': 0
})
check('方案开启达级加分', r.get('code') == 0, str(r.get('message', '')))
r = api('POST', '/api/track-stats/team-score/calc', {'competition_id': CID, 'rule_id': RULE1})
rows3 = api('GET', f'/api/track-stats/team-score/total?rule_id={RULE1}').get('data') or []
gb = sum(float(x['grade_bonus']) for x in rows3)
print('  达级加分合计:', gb)
check('达级加分计入总分', gb > 0, f'{gb}')

# ============================================================
# 4. 破纪录
# ============================================================
print('\n===== 4. 破纪录 =====')
r = api('POST', '/api/track-stats/records', {
    'competition_id': CID, 'event_item_id': E1, 'band_id': BID,
    'meet_record_value': '11.90', 'meet_record_holder': '往届冠军',
    'meet_record_meet_name': '上届运动会', 'meet_record_date': '2025-10-01',
    'highest_record_value': '11.70', 'highest_record_holder': '市纪录保持者'
})
print('  登记纪录:', json.dumps(r, ensure_ascii=False)[:200])
check('登记纪录', r.get('code') == 0, str(r.get('message', '')))
REC = (r.get('data') or {}).get('id')

r = api('PUT', '/api/track-stats/record-bonus-rules', {
    'competition_id': CID,
    'rows': [{'record_type': 'MEET', 'bonus_value': 10}, {'record_type': 'HIGHEST', 'bonus_value': 20}]
})
check('破纪录加分规则', r.get('code') == 0, str(r.get('message', '')))

r = api('POST', '/api/track-stats/record/detect', {'competition_id': CID})
print('  检测:', json.dumps(r, ensure_ascii=False)[:300])
check('破纪录检测', r.get('code') == 0, str(r.get('message', '')))

brs = api('GET', f'/api/track-stats/record-breaks?competition_id={CID}').get('data') or []
print('  破纪录名单:')
for b in brs:
    print(f"   {b['athlete_name']} {b['event_name']} {b['result_text']} 破{b['record_type']}（原 {b['old_value']}）+{b['bonus_value']}")
# 11.50 破赛会(11.90) + 破最高(11.70) = 2 条；11.80 破赛会 = 1 条
check('破赛会纪录 2 条', sum(1 for b in brs if b['record_type'] == 'MEET') == 2,
      f"{sum(1 for b in brs if b['record_type'] == 'MEET')} 条")
check('破最高纪录 1 条', sum(1 for b in brs if b['record_type'] == 'HIGHEST') == 1,
      f"{sum(1 for b in brs if b['record_type'] == 'HIGHEST')} 条")

# 纪录被刷新
rec = mq(f"SELECT meet_record_value, meet_record_holder, highest_record_value FROM meet_record WHERE id={REC}")
print('  刷新后纪录:', rec)
check('赛会纪录被刷新为 11.50', '11.50' in rec, rec)

recs = api('GET', f'/api/track-stats/records?competition_id={CID}').get('data') or []
check('纪录台账可查', len(recs) >= 1, f'{len(recs)} 条')

# ============================================================
# 5. 综合查询
# ============================================================
print('\n===== 5. 综合查询 =====')
sm = api('GET', f'/api/track-stats/query/summary?competition_id={CID}').get('data') or {}
print('  总览:', json.dumps(sm, ensure_ascii=False))
check('总览有数据', sm.get('athlete_count', 0) > 0, f"人数={sm.get('athlete_count')}")

ath = api('GET', f'/api/track-stats/query/athletes?competition_id={CID}').get('data') or []
print('  运动员榜:', [(a['athlete_name'], a['first_count'], a['second_count']) for a in ath[:5]])
check('按运动员查询', len(ath) > 0, f'{len(ath)} 人')

d = api('GET', f'/api/track-stats/query/athlete/{ath[0]["athlete_id"]}/detail?competition_id={CID}').get('data') or []
print('  单人明细:', [(x['event_name'], x['result_text'], x['rank_no']) for x in d])
check('单人成绩明细', len(d) >= 1, f'{len(d)} 条')

sch = api('GET', f'/api/track-stats/query/schools?competition_id={CID}').get('data') or []
print('  单位榜:', [(s['school_name'], s['first_count'], s['athlete_count']) for s in sch])
check('按单位查询', len(sch) == 3, f'{len(sch)} 个单位')

ev = api('GET', f'/api/track-stats/query/events?competition_id={CID}').get('data') or []
print('  项目榜:', [(e['event_name'], e['entry_count'], e['abnormal_count']) for e in ev])
check('按项目查询', len(ev) == 2, f'{len(ev)} 个项目')
ab = sum(int(e['abnormal_count'] or 0) for e in ev)
check('未完赛统计正确(DNS+NM=2)', ab == 2, f'{ab} 条')

# 关键字搜索
kw = api('GET', f'/api/track-stats/query/athletes?competition_id={CID}&keyword=P4-2-').get('data') or []
check('关键字搜索', len(kw) == 3, f'{len(kw)} 人')

# ============================================================
# 6. 公开页
# ============================================================
print('\n===== 6. 公开页 =====')
r = api('PUT', '/api/track-stats/public-config',
        {'competition_id': CID, 'public_flag': 1, 'public_note': '成绩公示，如有异议请联系组委会'})
print('  配置:', json.dumps(r, ensure_ascii=False)[:200])
check('公开配置保存', r.get('code') == 0, str(r.get('message', '')))
UUID = (r.get('data') or {}).get('uuid')
check('生成分享码', UUID is not None, f'uuid={UUID}')

pub = api('GET', f'/api/public/meet/{UUID}', auth=False)
print('  公开页:', json.dumps(pub, ensure_ascii=False)[:250])
check('公开页免登录可访问', pub.get('code') == 0, str(pub.get('message', '')))
if pub.get('data'):
    d = pub['data']
    print('  赛事:', d['competition']['name'], '| 项目数:', len(d['events']), '| 成绩块:', len(d['results']))
    check('公开页有成绩', len(d['results']) > 0, f"{len(d['results'])} 块")
    if d['results']:
        print('  样本:', d['results'][0]['event_name'], [(r2['rank'], r2['name'], r2['result']) for r2 in d['results'][0]['rows'][:4]])

ts = api('GET', f'/api/public/meet/{UUID}/team-score', auth=False).get('data') or {}
check('公开页团体总分', (ts.get('rows') or []) != [], f"{len(ts.get('rows') or [])} 行")

# 关闭后不可访问
api('PUT', '/api/track-stats/public-config', {'competition_id': CID, 'public_flag': 0})
closed = api('GET', f'/api/public/meet/{UUID}', auth=False)
check('关闭后不可访问', closed.get('code') != 0, str(closed.get('message', '')))
api('PUT', '/api/track-stats/public-config', {'competition_id': CID, 'public_flag': 1})

r = api('POST', '/api/track-stats/public-config/reset-uuid', {'competition_id': CID})
NEW = (r.get('data') or {}).get('uuid')
check('重新生成分享码', NEW and NEW != UUID, f'{UUID} -> {NEW}')

# ============================================================
# 7. 大屏控制端
# ============================================================
print('\n===== 7. 大屏控制端 =====')
r = api('PUT', '/api/screen-control/config', {
    'competition_id': CID, 'theme': 'BLUE', 'layout': 'MIXED',
    'dwell_seconds': 15, 'refresh_seconds': 20, 'latest_count': 8,
    'show_team_score': 1, 'show_latest': 1, 'show_upcoming': 0, 'show_record': 1,
    'queue_json': [{'event_item_id': E1, 'band_id': BID, 'seconds': 12}]
})
print('  保存:', json.dumps(r, ensure_ascii=False)[:200])
check('大屏配置保存', r.get('code') == 0, str(r.get('message', '')))

cfg = api('GET', f'/api/screen-control/config?competition_id={CID}').get('data') or {}
print('  回读:', json.dumps({k: cfg.get(k) for k in ['theme', 'layout', 'dwell_seconds', 'refresh_seconds', 'show_upcoming']}, ensure_ascii=False))
check('配置回读一致', cfg.get('theme') == 'BLUE' and cfg.get('dwell_seconds') == 15,
      f"theme={cfg.get('theme')} dwell={cfg.get('dwell_seconds')}")
check('队列回读', (cfg.get('queue_json') or [{}])[0].get('event_item_id') == E1, str(cfg.get('queue_json')))

qi = api('GET', f'/api/screen-control/queue-items?competition_id={CID}').get('data') or []
print('  可播放项:', [(x['event_name'], x['heat_count'], x['confirmed_count']) for x in qi])
check('播放项列表', len(qi) == 2, f'{len(qi)} 项')

r = api('POST', '/api/screen-control/insert',
        {'competition_id': CID, 'insert_text': '请各代表队领队立即到主席台开会', 'minutes': 5})
print('  插播:', json.dumps(r, ensure_ascii=False)[:200])
check('插播开启', r.get('code') == 0, str(r.get('message', '')))

scr = api('GET', f'/api/public/screen/{NEW}', auth=False)
print('  大屏数据:', json.dumps(scr, ensure_ascii=False)[:300])
check('大屏免登录取数', scr.get('code') == 0, str(scr.get('message', '')))
if scr.get('data'):
    sd = scr['data']
    print('  主题:', sd['config']['theme'], '| 插播:', (sd.get('insert') or {}).get('text'))
    print('  最新成绩:', len(sd.get('latest') or []), '条 | 破纪录:', len(sd.get('records') or []), '条')
    check('大屏主题生效', sd['config']['theme'] == 'BLUE', str(sd['config']['theme']))
    check('大屏有插播内容', bool((sd.get('insert') or {}).get('text')), '')
    check('大屏有最新成绩', len(sd.get('latest') or []) > 0, f"{len(sd.get('latest') or [])} 条")
    check('大屏有破纪录', len(sd.get('records') or []) > 0, f"{len(sd.get('records') or [])} 条")
    check('大屏有团体总分', bool(sd.get('teamScore')), '')

r = api('POST', '/api/screen-control/insert/clear', {'competition_id': CID})
check('插播关闭', r.get('code') == 0, str(r.get('message', '')))
scr2 = api('GET', f'/api/public/screen/{NEW}', auth=False).get('data') or {}
check('关闭后大屏无插播', scr2.get('insert') is None, str(scr2.get('insert')))

# ============================================================
# 8. 清理
# ============================================================
print('\n===== 8. 清理测试数据 =====')
clean = """
DELETE FROM team_score_item WHERE competition_id IN (SELECT id FROM competition WHERE name='P4测试赛');
DELETE FROM team_score_total WHERE competition_id IN (SELECT id FROM competition WHERE name='P4测试赛');
DELETE FROM virtual_group WHERE competition_id IN (SELECT id FROM competition WHERE name='P4测试赛');
DELETE FROM team_score_rule WHERE competition_id IN (SELECT id FROM competition WHERE name='P4测试赛');
DELETE FROM screen_config WHERE competition_id IN (SELECT id FROM competition WHERE name='P4测试赛');
DELETE FROM grade_achievement WHERE competition_id IN (SELECT id FROM competition WHERE name='P4测试赛');
DELETE FROM record_break WHERE competition_id IN (SELECT id FROM competition WHERE name='P4测试赛');
DELETE FROM meet_record WHERE competition_id IN (SELECT id FROM competition WHERE name='P4测试赛');
DELETE FROM meet_grade_bonus_rule WHERE competition_id IN (SELECT id FROM competition WHERE name='P4测试赛');
DELETE FROM meet_record_bonus_rule WHERE competition_id IN (SELECT id FROM competition WHERE name='P4测试赛');
DELETE FROM grade_standard_threshold WHERE standard_id IN (SELECT id FROM grade_standard WHERE standard_code='P4TEST');
DELETE FROM grade_standard WHERE standard_code='P4TEST';
DELETE FROM field_attempt WHERE heat_entry_id NOT IN (SELECT id FROM heat_entry);
DELETE FROM heat_entry WHERE competition_id IN (SELECT id FROM competition WHERE name='P4测试赛');
DELETE FROM track_heat WHERE competition_id IN (SELECT id FROM competition WHERE name='P4测试赛');
DELETE FROM arrangement_rule WHERE competition_id IN (SELECT id FROM competition WHERE name='P4测试赛');
DELETE FROM athlete_entry WHERE competition_id IN (SELECT id FROM competition WHERE name='P4测试赛');
DELETE FROM event_item WHERE competition_id IN (SELECT id FROM competition WHERE name='P4测试赛');
DELETE FROM group_band WHERE competition_id IN (SELECT id FROM competition WHERE name='P4测试赛');
DELETE FROM competition WHERE name='P4测试赛';
DELETE FROM athlete WHERE name LIKE 'P4-%';
SELECT 'cleaned';
"""
o, e = run(f"""mysql -ucompete -p'Compete@2026' sport_compete -e "{clean}" 2>&1 | grep -v Warning""")
print(o or e)

print('\n================ 汇总 ================')
print(f'通过 {len(PASS)} 项，失败 {len(FAIL)} 项')
if FAIL:
    print('失败项:', FAIL)
cli.close()
