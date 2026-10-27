# -*- coding: utf-8 -*-
"""第三期端到端实测：号码簿 / 临时变更 / 打印取数 / 成绩公布 / 裁判账号"""
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
    """执行 mysql 并返回结果文本"""
    o, e = run(f"""mysql -ucompete -p'Compete@2026' sport_compete -N -e "{sql}" 2>&1 | grep -v Warning""")
    return o or e


PASS, FAIL = [], []


def check(name, cond, detail=''):
    if cond:
        PASS.append(name)
        print(f'  [OK] {name} {detail}')
    else:
        FAIL.append(name)
        print(f'  [!!] {name} {detail}')


# ============================================================
# 0. 造测试数据
# ============================================================
print('\n===== 0. 造测试数据 =====')
setup = """
DELETE FROM bib_number WHERE competition_id IN (SELECT id FROM competition WHERE name='P3测试赛');
DELETE FROM participant_change WHERE competition_id IN (SELECT id FROM competition WHERE name='P3测试赛');
DELETE FROM heat_entry WHERE competition_id IN (SELECT id FROM competition WHERE name='P3测试赛');
DELETE FROM track_heat WHERE competition_id IN (SELECT id FROM competition WHERE name='P3测试赛');
DELETE FROM arrangement_rule WHERE competition_id IN (SELECT id FROM competition WHERE name='P3测试赛');
DELETE FROM athlete_entry WHERE competition_id IN (SELECT id FROM competition WHERE name='P3测试赛');
DELETE FROM event_item WHERE competition_id IN (SELECT id FROM competition WHERE name='P3测试赛');
DELETE FROM group_band WHERE competition_id IN (SELECT id FROM competition WHERE name='P3测试赛');
DELETE FROM referee_account WHERE competition_id IN (SELECT id FROM competition WHERE name='P3测试赛');
DELETE FROM score_announcement WHERE competition_id IN (SELECT id FROM competition WHERE name='P3测试赛');
DELETE FROM print_form_config WHERE competition_id IN (SELECT id FROM competition WHERE name='P3测试赛');
DELETE FROM athlete WHERE name LIKE 'P3-%';
DELETE FROM competition WHERE name='P3测试赛';

INSERT INTO competition (name, year, status, start_date, end_date)
VALUES ('P3测试赛', YEAR(CURDATE()), 1, CURDATE(), CURDATE());
SET @cid = (SELECT id FROM competition WHERE name='P3测试赛');

INSERT INTO group_band (competition_id, stage, gender, group_type, label, sort_no)
VALUES (@cid, 1, 1, 'NORMAL', '初中男子', 1);
SET @bid = (SELECT id FROM group_band WHERE competition_id=@cid LIMIT 1);

INSERT INTO event_item (competition_id, name, category, event_type, result_entry_type,
  event_unit, is_higher_better, result_decimal_places, need_lane_order, sort_no)
VALUES (@cid, '100米', 1, 'TRACK', 'TIME', '秒', 0, 2, 1, 1);
SET @e1 = (SELECT id FROM event_item WHERE competition_id=@cid AND name='100米');

INSERT INTO event_item (competition_id, name, category, event_type, result_entry_type,
  event_unit, is_higher_better, result_decimal_places, need_lane_order, sort_no,
  base_attempt_count, extra_attempt_count, extra_qualifier_count)
VALUES (@cid, '跳远', 1, 'FIELD', 'DISTANCE', '米', 1, 2, 0, 2, 3, 3, 8);
SET @e2 = (SELECT id FROM event_item WHERE competition_id=@cid AND name='跳远');

-- 第三个项目：无人报名，供「改项」测试用
INSERT INTO event_item (competition_id, name, category, event_type, result_entry_type,
  event_unit, is_higher_better, result_decimal_places, need_lane_order, sort_no)
VALUES (@cid, '200米', 1, 'TRACK', 'TIME', '秒', 0, 2, 1, 3);
SET @e3 = (SELECT id FROM event_item WHERE competition_id=@cid AND name='200米');

-- 3 所学校各 4 人 = 12 人
INSERT INTO athlete (school_id, name, gender, class_name)
SELECT s.id, CONCAT('P3-', s.id, '-', seq.n), 1, '九年级1班'
FROM (SELECT 2 AS id UNION SELECT 3 UNION SELECT 6) s
CROSS JOIN (SELECT 1 AS n UNION SELECT 2 UNION SELECT 3 UNION SELECT 4) seq;

INSERT INTO athlete_entry (competition_id, band_id, athlete_id, event_item_id, status)
SELECT @cid, @bid, a.id, @e1, 2 FROM athlete a WHERE a.name LIKE 'P3-%';

INSERT INTO athlete_entry (competition_id, band_id, athlete_id, event_item_id, status)
SELECT @cid, @bid, a.id, @e2, 2 FROM athlete a WHERE a.name LIKE 'P3-%';

-- 2 名只报跳远、不报 100 米的运动员，供「换人」测试用
INSERT INTO athlete (school_id, name, gender, class_name)
VALUES (2, 'P3-替补A', 1, '九年级2班'), (3, 'P3-替补B', 1, '九年级2班');
INSERT INTO athlete_entry (competition_id, band_id, athlete_id, event_item_id, status)
SELECT @cid, @bid, a.id, @e2, 2 FROM athlete a WHERE a.name IN ('P3-替补A','P3-替补B');

SELECT CONCAT('cid=', @cid, ' bid=', @bid, ' e1=', @e1, ' e2=', @e2, ' e3=', @e3);
"""
o, e = run(f"""mysql -ucompete -p'Compete@2026' sport_compete -e "{setup}" 2>&1 | grep -v Warning""")
print(o or e)

ids = mq("""SELECT CONCAT(c.id,'|',b.id,'|',e1.id,'|',e2.id,'|',e3.id)
FROM competition c
JOIN group_band b ON b.competition_id=c.id
JOIN event_item e1 ON e1.competition_id=c.id AND e1.name='100米'
JOIN event_item e2 ON e2.competition_id=c.id AND e2.name='跳远'
JOIN event_item e3 ON e3.competition_id=c.id AND e3.name='200米'
WHERE c.name='P3测试赛';""")
print('ids:', ids)
CID, BID, E1, E2, E3 = [int(x) for x in ids.split('|')]
print(f'赛事={CID} 组别={BID} 100米={E1} 跳远={E2} 200米={E3}')

cnt = mq(f"SELECT COUNT(*) FROM athlete_entry WHERE competition_id={CID}")
print('报名条数:', cnt)

# ============================================================
# 1. 编排（为后续变更做准备）
# ============================================================
print('\n===== 1. 分组编排 =====')
# 签 token
o, e = run(f"""cd /home/single/sport-compete/server && set -a && . ./.env && set +a && node -e "
const jwt=require('jsonwebtoken');
console.log(jwt.sign({{id:1,username:'admin',role:1,real_name:'管理员'}}, process.env.JWT_SECRET, {{expiresIn:'2h'}}));
" """)
TOKEN = (o or e).strip().split('\n')[-1]
print('token 长度:', len(TOKEN))


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
        return {'raw': o, 'err': e}


r = api('PUT', '/api/track-result/arrange-rule',
        {'competition_id': CID, 'event_item_id': E1, 'band_id': BID,
         'round_code': 'FINAL', 'round_mode': 'AUTO', 'lane_count': 8,
         'heat_capacity': 6, 'lane_order_mode': 'SNAKE'})
print('  编排规则:', r.get('msg') or r)

r = api('POST', '/api/track-result/arrange',
        {'competition_id': CID, 'event_item_id': E1, 'band_id': BID, 'round_code': 'FINAL'})
print('  编排结果:', json.dumps(r, ensure_ascii=False)[:300])
check('100米分组编排', r.get('code') == 0 or r.get('data') is not None, str(r.get('msg', '')))

r = api('PUT', '/api/track-result/arrange-rule',
        {'competition_id': CID, 'event_item_id': E2, 'band_id': BID,
         'round_code': 'FINAL', 'round_mode': 'AUTO', 'lane_count': 8,
         'heat_capacity': 12, 'lane_order_mode': 'SNAKE'})
r = api('POST', '/api/track-result/arrange',
        {'competition_id': CID, 'event_item_id': E2, 'band_id': BID, 'round_code': 'FINAL'})
print('  跳远编排:', json.dumps(r, ensure_ascii=False)[:200])
check('跳远分组编排', r.get('code') == 0 or r.get('data') is not None, str(r.get('msg', '')))

wb = api('GET', f'/api/track-result/workbench?competition_id={CID}&event_item_id={E1}&band_id={BID}')
heats = wb.get('data') or []
print('  分组:', [(h.get('id'), h.get('heat_no'), h.get('lane_count'), h.get('entry_count')) for h in heats])
HEAT1 = heats[0].get('id') if heats else None
check('工作台取分组', HEAT1 is not None, f'heat1={HEAT1}')

# ============================================================
# 2. 号码簿
# ============================================================
print('\n===== 2. 号码簿 =====')
r = api('POST', '/api/track-race/bibs/generate',
        {'competition_id': CID, 'mode': 'SCHOOL_SEGMENT', 'number_length': 4,
         'start_number': 1, 'gender_order': 'M_F'})
print('  生成:', json.dumps(r, ensure_ascii=False)[:200])
check('号码簿生成', r.get('code') == 0, str(r.get('msg', '')))

r0 = api('GET', f'/api/track-race/bibs?competition_id={CID}')
bibs = r0.get('data') or []
print('  号码样本:', [(b.get('bib_no'), b.get('school_name')) for b in bibs[:6]], '...共', len(bibs))
check('号码写入数量=14', len(bibs) == 14, f'实际 {len(bibs)}')
check('号码簿列表查询', r0.get('code') == 0 and len(bibs) == 14, f'{len(bibs)} 条')
if bibs:
    for sid in (2, 3, 6):
        print(f'  学校{sid}:', [b.get('bib_no') for b in bibs if b.get('school_id') == sid])

# 改号
if bibs:
    r = api('PUT', f"/api/track-race/bibs/{bibs[0]['id']}", {'bib_no': '9999'})
    check('手工改号', r.get('code') == 0, str(r.get('msg', '')))
    chk = mq(f"SELECT bib_no FROM bib_number WHERE id={bibs[0]['id']}")
    check('改号落库', chk.strip() == '9999', f'库里={chk}')
    ath = mq(f"SELECT bib_no FROM athlete WHERE id={bibs[0]['athlete_id']}")
    check('改号回写运动员表', ath.strip() == '9999', f'athlete.bib_no={ath}')
    api('PUT', f"/api/track-race/bibs/{bibs[0]['id']}", {'bib_no': bibs[0]['bib_no']})

r = api('GET', f'/api/track-race/bibs/missing?competition_id={CID}')
d = r.get('data') or {}
print('  缺号:', len(d.get('noBib', [])), ' 重号:', len(d.get('dup', [])))
check('缺号/重号检查', r.get('code') == 0, str(r.get('msg', '')))

# ============================================================
# 3. 临时变更
# ============================================================
print('\n===== 3. 临时变更 =====')
# 取第一组的一个 entry
hd = api('GET', f'/api/track-result/heat/{HEAT1}')
entries = (hd.get('data') or {}).get('entries') or (hd.get('data') or {}).get('rows') or []
print('  第一组:', [(e.get('id'), e.get('athlete_name'), e.get('lane_no')) for e in entries])
ENT = entries[0] if entries else None
check('组内名单读取', ENT is not None, f'{len(entries)} 人')

# 3.1 临时报名（新增一个运动员）
r = api('POST', '/api/track-race/changes',
        {'competition_id': CID, 'change_type': 'TEMP_ENTRY', 'event_item_id': E1,
         'band_id': BID, 'new_athlete_name': 'P3-临时报名', 'new_school_id': 2,
         'gender': 1, 'reason': '现场补报'})
print('  临时报名:', json.dumps(r, ensure_ascii=False)[:250])
check('临时报名', r.get('code') == 0, str(r.get('msg', '')))
te_id = (r.get('data') or {}).get('change_id')
te_ent = (r.get('data') or {}).get('heat_entry_id')
check('临时报名写入分组', te_ent is not None, f'heat_entry_id={te_ent}')

# 3.2 撤赛
r = api('POST', '/api/track-race/changes',
        {'competition_id': CID, 'change_type': 'WITHDRAWAL',
         'old_heat_entry_id': entries[1]['id'] if len(entries) > 1 else ENT['id'],
         'reason': '受伤退赛'})
print('  撤赛:', json.dumps(r, ensure_ascii=False)[:200])
check('撤赛', r.get('code') == 0, str(r.get('msg', '')))
wd_id = (r.get('data') or {}).get('change_id')
wd_ent = entries[1]['id'] if len(entries) > 1 else ENT['id']
st = mq(f"SELECT status_code FROM heat_entry WHERE id={wd_ent}")
check('撤赛后状态=WD', st.strip() == 'WD', f'实际={st}')

# 3.3 换人：替补必须是不在本组的运动员
cand = api('GET', f'/api/track-race/changes/candidates?competition_id={CID}&band_id={BID}&event_item_id={E1}&kind=replace')
cands = cand.get('data') or []
inHeat = {e.get('athlete_id') for e in entries}
outsiders = [c for c in cands if c.get('athlete_id') not in inHeat]
print('  可换人候选（不在本组）:', [(c.get('athlete_id'), c.get('athlete_name')) for c in outsiders[:4]])
if len(entries) > 2 and outsiders:
    r = api('POST', '/api/track-race/changes',
            {'competition_id': CID, 'change_type': 'REPLACEMENT',
             'old_heat_entry_id': entries[2]['id'],
             'replace_athlete_id': outsiders[0]['athlete_id'],
             'reason': '换人'})
    print('  换人:', json.dumps(r, ensure_ascii=False)[:250])
    check('换人', r.get('code') == 0, str(r.get('msg', '')))
    rp_id = (r.get('data') or {}).get('change_id')
    rp_ent = (r.get('data') or {}).get('heat_entry_id')
    if rp_ent:
        nr = mq(f"SELECT athlete_name FROM heat_entry WHERE id={rp_ent}")
        check('换人后新记录落组', outsiders[0].get('athlete_name') in nr, f'实际={nr}')

# 3.3b 重复换人应被拒绝
if len(entries) > 2 and len(inHeat) > 3:
    dup_id = [e.get('athlete_id') for e in entries if e.get('athlete_id') != entries[2].get('athlete_id')][0]
    r = api('POST', '/api/track-race/changes',
            {'competition_id': CID, 'change_type': 'REPLACEMENT',
             'old_heat_entry_id': entries[2]['id'], 'replace_athlete_id': dup_id, 'reason': '重复测试'})
    check('重复换人被拒绝', r.get('code') != 0 and '已在' in str(r.get('message', '')), str(r.get('message', ''))[:60])

# 3.4 改名
r = api('POST', '/api/track-race/changes',
        {'competition_id': CID, 'change_type': 'NAME_CHANGE',
         'old_athlete_id': entries[0]['athlete_id'], 'after_name': 'P3-改后名字',
         'reason': '户籍名更正'})
print('  改名:', json.dumps(r, ensure_ascii=False)[:200])
check('改名', r.get('code') == 0, str(r.get('msg', '')))
nm_id = (r.get('data') or {}).get('change_id')
nm_after = mq(f"SELECT name FROM athlete WHERE id={entries[0]['athlete_id']}")
check('改名落到运动员表', '改后名字' in nm_after, f'实际={nm_after}')

# 3.5 改项：改到无人报名的 200 米
tgt = entries[4]['athlete_id'] if len(entries) > 4 else entries[0]['athlete_id']
r = api('POST', '/api/track-race/changes',
        {'competition_id': CID, 'change_type': 'EVENT_CHANGE',
         'event_item_id': E1, 'band_id': BID,
         'old_athlete_id': tgt, 'to_event_item_id': E3, 'reason': '改报200米'})
print('  改项:', json.dumps(r, ensure_ascii=False)[:250])
check('改项', r.get('code') == 0, str(r.get('msg', '')))
newent = mq(f"SELECT COUNT(*) FROM athlete_entry WHERE competition_id={CID} AND event_item_id={E3} AND athlete_id={tgt}")
check('改项后新项目有报名', newent.strip() == '1', f'实际={newent}')
oldwd = mq(f"SELECT status_code FROM heat_entry WHERE heat_id={HEAT1} AND athlete_id={tgt}")
check('改项后原项目撤下', 'WD' in oldwd, f'实际={oldwd}')

# 3.6 变更列表
r = api('GET', f'/api/track-race/changes?competition_id={CID}')
rows = r.get('data') or []
print('  变更列表条数:', len(rows))
for x in rows:
    print(f"    #{x['id']} {x['change_type']} {x.get('event_name')} | 原:{x.get('old_athlete_name')} → 新:{x.get('new_athlete_name')} | {x.get('reason')}")
check('变更列表 ≥5 条', len(rows) >= 5, f'实际 {len(rows)}')

# 3.7 撤销
if wd_id:
    r = api('POST', f'/api/track-race/changes/{wd_id}/revoke')
    print('  撤销撤赛:', json.dumps(r, ensure_ascii=False)[:200])
    check('撤销变更', r.get('code') == 0, str(r.get('msg', '')))
    st2 = mq(f"SELECT status_code FROM heat_entry WHERE id={wd_ent}")
    check('撤销后状态还原', st2.strip() in ('', 'NULL', 'None'), f'实际={st2!r}')
    rev = mq(f"SELECT revoked FROM participant_change WHERE id={wd_id}")
    check('撤销标记 revoked=1', rev.strip() == '1', f'实际={rev}')

r = api('GET', f'/api/track-race/changes/candidates?competition_id={CID}&event_item_id={E1}&band_id={BID}')
print('  候选:', json.dumps(r, ensure_ascii=False)[:200])
check('变更候选人查询', r.get('code') == 0, str(r.get('msg', '')))

# ============================================================
# 4. 检录表 / 成绩单 打印取数
# ============================================================
print('\n===== 4. 打印 =====')
r = api('GET', f'/api/track-race/form-config?competition_id={CID}')
print('  打印配置:', json.dumps(r, ensure_ascii=False)[:200])
check('打印配置读取', r.get('code') == 0, str(r.get('msg', '')))

r = api('PUT', '/api/track-race/form-config',
        {'competition_id': CID, 'form_type': 'CALL_ROOM', 'title': 'P3测试赛检录表',
         'show_school': 1, 'show_bib': 1, 'show_lane': 1, 'show_photo': 0,
         'columns': 'lane,bib,name,school', 'page_size': 'A4', 'orientation': 'portrait'})
check('打印配置保存', r.get('code') == 0, str(r.get('msg', '')))

r = api('GET', f'/api/track-race/form-data?competition_id={CID}&form_type=CALL_ROOM&heat_id={HEAT1}')
d = r.get('data') or {}
print('  检录表数据:', json.dumps(d, ensure_ascii=False)[:400])
check('检录表取数', r.get('code') == 0 and (d.get('rows') or d.get('list') or d.get('entries')), '')

r = api('GET', f'/api/track-race/form-data?competition_id={CID}&form_type=RESULT&heat_id={HEAT1}')
d = r.get('data') or {}
print('  成绩单数据:', json.dumps(d, ensure_ascii=False)[:400])
check('成绩单取数', r.get('code') == 0, str(r.get('msg', '')))

# ============================================================
# 5. 成绩公布
# ============================================================
print('\n===== 5. 成绩公布 =====')
r = api('PUT', '/api/track-race/announcement/config',
        {'competition_id': CID, 'announce_flag': 1, 'announce_auto_flag': 1, 'announce_show_school': 1})
check('公布开关保存', r.get('code') == 0, str(r.get('msg', '')))

r = api('GET', f'/api/track-race/announcement?competition_id={CID}')
print('  公布状态:', json.dumps(r, ensure_ascii=False)[:250])
check('公布状态读取', r.get('code') == 0, str(r.get('msg', '')))

r = api('POST', '/api/track-race/announcement/publish',
        {'competition_id': CID, 'heat_ids': [HEAT1, heats[1].get('id')] if len(heats) > 1 else [HEAT1]})
print('  发布:', json.dumps(r, ensure_ascii=False)[:250])
check('成绩发布', r.get('code') == 0, str(r.get('msg', '')))
acnt = mq(f"SELECT COUNT(*) FROM score_announcement WHERE competition_id={CID}")
check('公布记录落库', acnt.strip() != '0', f'{acnt} 条')

r = api('POST', '/api/track-race/announcement/withdraw',
        {'competition_id': CID, 'heat_ids': [HEAT1, heats[1].get('id')] if len(heats) > 1 else [HEAT1]})
print('  撤回:', json.dumps(r, ensure_ascii=False)[:250])
check('成绩撤回', r.get('code') == 0, str(r.get('msg', '')))

# ============================================================
# 6. 裁判员账号
# ============================================================
print('\n===== 6. 裁判员账号 =====')
r = api('POST', '/api/track-race/referee-accounts',
        {'competition_id': CID, 'username': 'p3ref01', 'password': '123456',
         'real_name': 'P3裁判甲', 'event_item_id': E1, 'phone': '13800000001'})
print('  新增:', json.dumps(r, ensure_ascii=False)[:250])
check('裁判账号新增', r.get('code') == 0, str(r.get('msg', '')))
rid = (r.get('data') or {}).get('id')

r = api('GET', f'/api/track-race/referee-accounts?competition_id={CID}')
rows = r.get('data') or []
print('  列表:', [(x['id'], x['username'], x['real_name']) for x in rows])
check('裁判账号列表', len(rows) >= 1, f'{len(rows)} 条')
if not rid and rows:
    rid = rows[0]['id']

r = api('PUT', f'/api/track-race/referee-accounts/{rid}',
        {'real_name': 'P3裁判乙', 'event_item_id': E2, 'phone': '13800000002', 'status': 1})
check('裁判账号修改', r.get('code') == 0, str(r.get('msg', '')))
nmo = mq(f"SELECT real_name FROM referee_account WHERE id={rid}")
check('改名落库', '裁判乙' in nmo, f'实际={nmo}')

r = api('PUT', f'/api/track-race/referee-accounts/{rid}/reset-password', {'password': 'abc123'})
check('重置密码', r.get('code') == 0, str(r.get('msg', '')))
pw = mq(f"SELECT password_hash FROM referee_account WHERE id={rid}")
print('  新密码哈希:', pw[:24], '...')

r = api('GET', f'/api/track-race/referee-accounts?competition_id={CID}')
print('  改后:', [(x['username'], x['real_name']) for x in (r.get('data') or [])])

# ============================================================
# 7. 清理
# ============================================================
print('\n===== 7. 清理测试数据 =====')
clean = """
DELETE FROM referee_account WHERE competition_id IN (SELECT id FROM competition WHERE name='P3测试赛');
DELETE FROM score_announcement WHERE competition_id IN (SELECT id FROM competition WHERE name='P3测试赛');
DELETE FROM print_form_config WHERE competition_id IN (SELECT id FROM competition WHERE name='P3测试赛');
DELETE FROM participant_change WHERE competition_id IN (SELECT id FROM competition WHERE name='P3测试赛');
DELETE FROM bib_number WHERE competition_id IN (SELECT id FROM competition WHERE name='P3测试赛');
DELETE FROM heat_entry WHERE competition_id IN (SELECT id FROM competition WHERE name='P3测试赛');
DELETE FROM field_attempt WHERE heat_entry_id NOT IN (SELECT id FROM heat_entry);
DELETE FROM track_heat WHERE competition_id IN (SELECT id FROM competition WHERE name='P3测试赛');
DELETE FROM arrangement_rule WHERE competition_id IN (SELECT id FROM competition WHERE name='P3测试赛');
DELETE FROM advancement_rule WHERE event_item_id IN (SELECT id FROM event_item WHERE competition_id IN (SELECT id FROM competition WHERE name='P3测试赛'));
DELETE FROM athlete_entry WHERE competition_id IN (SELECT id FROM competition WHERE name='P3测试赛');
DELETE FROM event_item WHERE competition_id IN (SELECT id FROM competition WHERE name='P3测试赛');
DELETE FROM group_band WHERE competition_id IN (SELECT id FROM competition WHERE name='P3测试赛');
DELETE FROM competition WHERE name='P3测试赛';
DELETE FROM athlete WHERE name LIKE 'P3-%';
SELECT 'cleaned';
"""
o, e = run(f"""mysql -ucompete -p'Compete@2026' sport_compete -e "{clean}" 2>&1 | grep -v Warning""")
print(o or e)

print('\n================ 汇总 ================')
print(f'通过 {len(PASS)} 项，失败 {len(FAIL)} 项')
if FAIL:
    print('失败项:', FAIL)
cli.close()
