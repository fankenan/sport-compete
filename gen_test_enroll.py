# -*- coding: utf-8 -*-
"""
为 4 个赛事生成测试用报名数据

赛事 2  登封市2026年中小学生秋季运动会（球类，无组别无项目 → 全套新建）
赛事 6  2027年高中篮球联赛（已有高中男女组别、篮球项目、12 支男子队 → 只补女子）
赛事 7  2027年初中篮球联赛（已有一个组别 + 两个赛区项目 → 新建女子组别 + 篮球项目）
赛事 30 登封市2027年中小学生田径运动会（无组别无项目 → 全套新建，个人报名）

学校规模（按用户口径）：
  赛事2：篮球 小20/初20/高6、足球 小5/初5/高5、羽毛球 初20/高5、乒乓球 小20/初20/高6，均男女
  赛事30：小20/初20/高6，男女，每校每性别 8 人，每人 2 项
"""
import json
import os
import paramiko

BASE = os.path.dirname(os.path.abspath(__file__))
REMOTE_DIR = '/home/single/sport-compete/server'

# ---------- 学校（Excel 学段顺序）----------
PRIMARY = [  # 小学 24 所
    '登封市颍阳镇中心小学', '登封市君召乡中心小学', '登封市石道乡中心小学', '登封市白坪镇中心小学',
    '登封市白坪镇第一小学', '登封市大金店镇中心小学', '登封市唐庄镇中心小学', '登封市东华镇中心小学',
    '登封市大冶镇中心小学', '登封市博文路小学', '登封市告成镇中心小学', '登封市宣化镇中心小学',
    '登封市徐庄镇中心小学', '登封市永泰路小学', '登封市崇高路小学', '登封市汉武路小学',
    '登封市昌盛路小学', '登封市商埠街小学', '登封市北区小学', '登封市书院河路小学',
    '登封市通达路小学', '登封市滨河路小学', '登封市嵩山路小学', '登封市中岳办第二小学',
]
JUNIOR = [  # 初中 21 所
    '登封市颍阳镇初级中学', '登封市君召乡初级中学', '登封市石道乡初级中学', '登封市白坪镇第一初级中学',
    '登封市大金店镇初级中学', '登封市唐庄镇初级中学', '登封市东华镇第一初级中学', '登封市直属第九初级中学',
    '登封市告成镇初级中学', '登封市宣化镇初级中学', '登封市徐庄镇初级中学', '登封市直属第六初级中学',
    '登封市直属第八初级中学', '登封市直属第一初级中学', '登封市直属第一初级中学少林校区',
    '登封市直属第二初级中学', '登封市直属第三初级中学', '登封市嵩阳中学', '登封市直属第五初级中学',
    '登封市直属第七初级中学', '登封新时代学校',
]
SENIOR = [  # 高中 6 所
    '登封市第一高级中学', '登封市嵩阳高级中学', '登封市实验高级中学',
    '登封市外国语高级中学', '登封市中等专业学校', '登封市少林中学',
]

# 赛事7 指定 8 所（东西赛区各 4 所）
J7_WEST = ['登封市直属第一初级中学', '登封市嵩阳中学', '登封市直属第六初级中学', '登封市直属第三初级中学']
J7_EAST = ['登封市直属第二初级中学', '登封市直属第五初级中学', '登封市直属第七初级中学', '登封市直属第八初级中学']

# ---------- 组别 ----------
BANDS_2 = [  # 赛事2
    {'stage': 1, 'gender': 1, 'label': '小学男子'},
    {'stage': 1, 'gender': 2, 'label': '小学女子'},
    {'stage': 2, 'gender': 1, 'label': '初中男子'},
    {'stage': 2, 'gender': 2, 'label': '初中女子'},
    {'stage': 3, 'gender': 1, 'label': '高中男子'},
    {'stage': 3, 'gender': 2, 'label': '高中女子'},
]
BANDS_30 = [
    {'stage': 1, 'gender': 1, 'label': '小学男子'},
    {'stage': 1, 'gender': 2, 'label': '小学女子'},
    {'stage': 2, 'gender': 1, 'label': '初中男子'},
    {'stage': 2, 'gender': 2, 'label': '初中女子'},
    {'stage': 3, 'gender': 1, 'label': '高中男子'},
    {'stage': 3, 'gender': 2, 'label': '高中女子'},
]
BANDS_7 = [
    {'stage': 2, 'gender': 2, 'label': '初中女子'},
]

# ---------- 球类项目 ----------
def ball(name, minutes, interval, allow_draw, win, draw):
    return {
        'name': name, 'category': 3, 'event_type': 'BALL',
        'match_minutes': minutes, 'slot_interval': interval,
        'allow_draw': allow_draw, 'win_points': win, 'draw_points': draw,
        'has_third_place': 1, 'group_count': 0, 'rounds_per_group': 0,
        'advance_count': 4, 'pairing_rule': 1,
    }


ITEMS_2 = [
    ball('篮球', 40, 50, 0, 2, 0),
    ball('足球', 60, 70, 1, 3, 1),
    ball('羽毛球', 35, 45, 0, 2, 0),
    ball('乒乓球', 25, 35, 0, 2, 0),
]
ITEMS_7 = [ball('篮球', 40, 50, 0, 2, 0)]

# ---------- 田径项目 ----------
def track(name, unit='s', lane=8, prelim=16, relay=0):
    return {
        'name': name, 'category': 1, 'event_type': 'RELAY' if relay else 'TRACK',
        'result_entry_type': 'TIME', 'event_unit': unit, 'is_higher_better': 0,
        'lane_count': lane, 'prelim_max': prelim, 'is_relay': relay,
        'need_lane_order': 1, 'base_attempt_count': 3, 'extra_attempt_count': 3,
    }


def field(name, entry_type='DISTANCE'):
    return {
        'name': name, 'category': 2, 'event_type': 'FIELD',
        'result_entry_type': entry_type, 'event_unit': 'm', 'is_higher_better': 1,
        'need_lane_order': 0, 'prelim_max': 0, 'lane_count': 0,
        'base_attempt_count': 3, 'extra_attempt_count': 3,
    }


ITEMS_30 = [
    track('60米', prelim=16),
    track('100米', prelim=16),
    track('200米', prelim=16),
    track('400米', prelim=16),
    track('800米', prelim=0),
    track('1500米', prelim=0),
    field('跳高', 'HEIGHT'),
    field('跳远'),
    field('铅球'),
    field('实心球'),
    track('4×100米接力', relay=1, prelim=0),
]

# ---------- 各学段可选项目（报名用；接力暂不报，避免 relay_lineup 复杂度）----------
EV_PER_STAGE = {
    1: ['60米', '100米', '200米', '400米', '800米', '跳高', '跳远', '实心球'],
    2: ['100米', '200米', '400米', '800米', '1500米', '跳高', '跳远', '铅球'],
    3: ['100米', '200米', '400米', '800米', '1500米', '跳高', '跳远', '铅球'],
}

CONFIG = {
    'bands2': BANDS_2, 'items2': ITEMS_2,
    'bands30': BANDS_30, 'items30': ITEMS_30,
    'bands7': BANDS_7, 'items7': ITEMS_7,
    'primary': PRIMARY, 'junior': JUNIOR, 'senior': SENIOR,
    'j7west': J7_WEST, 'j7east': J7_EAST,
    'evPerStage': {str(k): v for k, v in EV_PER_STAGE.items()},
    # 赛事2 各项目参赛学校数
    'size2': {
        '篮球': {'primary': 20, 'junior': 20, 'senior': 6},
        '足球': {'primary': 5, 'junior': 5, 'senior': 5},
        '羽毛球': {'primary': 0, 'junior': 20, 'senior': 5},
        '乒乓球': {'primary': 20, 'junior': 20, 'senior': 6},
    },
    'size30': {'primary': 20, 'junior': 20, 'senior': 6},
    'perSchoolPerGender': 8,   # 田径每校每性别人数
    'eventsPerAthlete': 2,     # 每人报几项
}

NODE = r'''
require('dotenv').config();
const fs = require('fs');
const { query, queryOne, execute } = require('./db');

const C = JSON.parse(fs.readFileSync('./_enroll_cfg.json', 'utf8'));
const log = (...a) => console.log(...a);
const stat = { bands: 0, items: 0, teams: 0, athletes: 0, entries: 0, skip: [] };

// 固定种子随机，保证可复现
let seed = 20261028;
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function pick(arr) { return arr[Math.floor(rnd() * arr.length)]; }
function randInt(a, b) { return a + Math.floor(rnd() * (b - a + 1)); }

// ---------- 姓名池 ----------
const XING = '王李张刘陈杨赵黄周吴徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾萧田董袁潘蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤';
const MING_M = ['伟','强','磊','军','洋','勇','杰','涛','明','超','鹏','浩然','子轩','宇航','俊杰','晨曦','博文','嘉豪','天翊','泽宇','思远','皓轩','雨泽','文博','浩瀚'];
const MING_F = ['芳','娜','敏','静','丽','艳','娟','霞','玲','洁','雨萱','诗涵','欣怡','梦琪','雅雯','思彤','可欣','若曦','嘉怡','紫涵','语桐','馨月','婉清','艺涵','悠然'];

function randName(gender) {
  const x = XING[Math.floor(rnd() * XING.length)];
  const pool = gender === 1 ? MING_M : MING_F;
  return x + pick(pool);
}
function randCoach() { return randName(rnd() > 0.7 ? 2 : 1); }

// ---------- 身份证（含校验位，生日与学段匹配）----------
const W = [7,9,10,5,8,4,2,1,6,3,7,9,10,5,8,4,2];
const CK = '10X98765432';
function genIdCard(stage, gender) {
  const y = stage === 1 ? randInt(2014, 2016) : stage === 2 ? randInt(2011, 2013) : randInt(2008, 2010);
  const m = randInt(1, 12);
  const d = randInt(1, 28);
  // 6 地址 + 8 生日 + 2 顺序 + 1 性别位 = 17 位，再加 1 位校验 = 18 位
  const ymd = String(y) + String(m).padStart(2,'0') + String(d).padStart(2,'0');
  const seq = String(randInt(0, 9)) + String(randInt(0, 9));
  // 第 17 位是性别位：男取奇数、女取偶数
  const g = gender === 1 ? [1,3,5,7,9][randInt(0,4)] : [0,2,4,6,8][randInt(0,4)];
  const s = '410185' + ymd + seq + String(g);
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += Number(s[i]) * W[i];
  return s + CK[sum % 11];
}

function classOf(stage) {
  const g = randInt(1, 6);
  if (stage === 1) return g + '年级' + randInt(1,4) + '班';
  if (stage === 2) return ['七','八','九'][g % 3] + '年级' + randInt(1,8) + '班';
  return ['高一','高二','高三'][g % 3] + randInt(1,10) + '班';
}

(async () => {
  const schoolId = {};
  for (const s of await query('SELECT id, name FROM school')) schoolId[s.name] = s.id;

  async function ensureBands(compId, bands) {
    const map = {};
    for (const b of bands) {
      let row = await queryOne(
        'SELECT id FROM group_band WHERE competition_id=? AND stage=? AND gender=? LIMIT 1',
        [compId, b.stage, b.gender]);
      if (row) { map[b.stage + '-' + b.gender] = row.id; continue; }
      const r = await execute(
        'INSERT INTO group_band (competition_id, stage, gender, label, sort_no) VALUES (?,?,?,?,?)',
        [compId, b.stage, b.gender, b.label, b.stage * 10 + b.gender]);
      map[b.stage + '-' + b.gender] = r.insertId;
      stat.bands++;
    }
    return map;
  }

  async function ensureItems(compId, items) {
    const map = {};
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      let row = await queryOne('SELECT id FROM event_item WHERE competition_id=? AND name=? LIMIT 1',
                               [compId, it.name]);
      if (row) { map[it.name] = row.id; continue; }
      const cols = Object.keys(it).filter(k => k !== 'name');
      const sql = 'INSERT INTO event_item (competition_id, name, ' + cols.join(',') + ', sort_no) VALUES (' +
        ['?', '?'].concat(cols.map(() => '?')).join(',') + ', ?)';
      const r = await execute(sql, [compId, it.name].concat(cols.map(k => it[k])).concat([(i + 1) * 10]));
      map[it.name] = r.insertId;
      stat.items++;
    }
    return map;
  }

  async function addTeam(compId, bandId, itemId, schoolName, gender, itemName) {
    const sid = schoolId[schoolName];
    if (!sid) { stat.skip.push('学校不存在:' + schoolName); return; }
    const dup = await queryOne('SELECT id FROM team_entry WHERE band_id=? AND event_item_id=? AND school_id=?',
                               [bandId, itemId, sid]);
    if (dup) return;
    const short = (await queryOne('SELECT short_name FROM school WHERE id=?', [sid]))?.short_name || schoolName;
    const r = await execute(
      'INSERT INTO team_entry (competition_id, band_id, event_item_id, school_id, team_name, leader_name, coach_name, status) VALUES (?,?,?,?,?,?,?,1)',
      [compId, bandId, itemId, sid,
       short + (gender === 1 ? '男' : '女') + itemName + '队',
       randName(gender), randCoach()]);
    stat.teams++;
  }

  // ========== 赛事 2：秋季运动会（球类）==========
  log('--- 赛事 2 ---');
  const b2 = await ensureBands(2, C.bands2);
  const i2 = await ensureItems(2, C.items2);
  const stageSchools2 = { 1: C.primary.slice(0, 20), 2: C.junior.slice(0, 20), 3: C.senior };
  for (const itemName of Object.keys(C.size2)) {
    const spec = C.size2[itemName];
    for (const stageKey of ['primary', 'junior', 'senior']) {
      const stage = stageKey === 'primary' ? 1 : stageKey === 'junior' ? 2 : 3;
      const n = spec[stageKey];
      if (!n) continue;
      const schools = stageSchools2[stage].slice(0, n);
      for (const gender of [1, 2]) {
        const bid = b2[stage + '-' + gender];
        for (const s of schools) await addTeam(2, bid, i2[itemName], s, gender, itemName);
      }
    }
  }

  // ========== 赛事 6：高中篮球（只补女子）==========
  log('--- 赛事 6 ---');
  const band6F = await queryOne('SELECT id FROM group_band WHERE competition_id=6 AND gender=2 LIMIT 1');
  const item6 = await queryOne('SELECT id FROM event_item WHERE competition_id=6 AND name=? LIMIT 1', ['篮球']);
  if (band6F && item6) {
    for (const s of C.senior) await addTeam(6, band6F.id, item6.id, s, 2, '篮球');
  } else {
    stat.skip.push('赛事6 缺女子组别或篮球项目');
  }

  // ========== 赛事 7：初中篮球（新建女子组别 + 篮球项目）==========
  log('--- 赛事 7 ---');
  const b7 = await ensureBands(7, C.bands7);
  const i7 = await ensureItems(7, C.items7);
  const band7M = await queryOne('SELECT id FROM group_band WHERE competition_id=7 AND gender=1 LIMIT 1');
  const eightSchools = C.j7west.concat(C.j7east);
  if (band7M) {
    for (const s of eightSchools) await addTeam(7, band7M.id, i7['篮球'], s, 1, '篮球');
  }
  for (const s of eightSchools) await addTeam(7, b7['2-2'], i7['篮球'], s, 2, '篮球');

  // ========== 赛事 30：田径（个人报名）==========
  log('--- 赛事 30 ---');
  const b30 = await ensureBands(30, C.bands30);
  const i30 = await ensureItems(30, C.items30);
  const stageSchools30 = { 1: C.primary.slice(0, 20), 2: C.junior.slice(0, 20), 3: C.senior };

  for (const stage of [1, 2, 3]) {
    const evPool = C.evPerStage[String(stage)].filter(n => i30[n]);
    for (const gender of [1, 2]) {
      const bid = b30[stage + '-' + gender];
      for (const sname of stageSchools30[stage]) {
        const sid = schoolId[sname];
        if (!sid) { stat.skip.push('学校不存在:' + sname); continue; }
        for (let k = 0; k < C.perSchoolPerGender; k++) {
          const nm = randName(gender);
          const idc = genIdCard(stage, gender);
          const birth = idc.slice(6,10) + '-' + idc.slice(10,12) + '-' + idc.slice(12,14);
          const ar = await execute(
            'INSERT INTO athlete (school_id, name, gender, gender_text, class_name, id_card, birth_date) VALUES (?,?,?,?,?,?,?)',
            [sid, nm, gender, gender === 1 ? '男' : '女', classOf(stage), idc, birth]);
          stat.athletes++;
          // 随机挑 eventsPerAthlete 个不重复项目
          const pool = evPool.slice();
          const chosen = [];
          for (let e = 0; e < C.eventsPerAthlete && pool.length; e++) {
            const idx = Math.floor(rnd() * pool.length);
            chosen.push(pool.splice(idx, 1)[0]);
          }
          for (const ev of chosen) {
            try {
              await execute('INSERT INTO athlete_entry (competition_id, band_id, athlete_id, event_item_id, status) VALUES (?,?,?,?,1)',
                            [30, bid, ar.insertId, i30[ev]]);
              stat.entries++;
            } catch (e) {
              if (!String(e.message).includes('Duplicate')) stat.skip.push('entry:' + e.message);
            }
          }
        }
      }
    }
  }

  log('\n===== 结果 =====');
  log(JSON.stringify(stat, null, 1));
  for (const cid of [2, 6, 7, 30]) {
    const t = await queryOne('SELECT COUNT(*) c FROM team_entry WHERE competition_id=?', [cid]);
    const a = await queryOne('SELECT COUNT(*) c FROM athlete_entry WHERE competition_id=?', [cid]);
    const b = await queryOne('SELECT COUNT(*) c FROM group_band WHERE competition_id=?', [cid]);
    const i = await queryOne('SELECT COUNT(*) c FROM event_item WHERE competition_id=?', [cid]);
    log(`赛事${cid}: 组别${b.c} 项目${i.c} 球队${t.c} 个人报名${a.c}`);
  }
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
'''

cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect('10.128.1.45', 22, 'single', 'jyj2026', timeout=20)


def run(cmd, t=600):
    _, o, e = cli.exec_command(cmd, timeout=t)
    out = o.read().decode('utf-8', 'replace').strip()
    err = e.read().decode('utf-8', 'replace').strip()
    return (out + ('\n' + err if err else '')).strip()


ENV = 'cd /home/single/sport-compete/server && set -a && . ./.env 2>/dev/null; set +a;'
print('===== 1. 备份 team_entry / athlete / athlete_entry / group_band / event_item =====')
print('  ' + run(f'{ENV} mysqldump -u$DB_USER -p$DB_PASSWORD -h$DB_HOST --single-transaction --skip-lock-tables '
                f'$DB_NAME team_entry athlete athlete_entry group_band event_item '
                f'> /home/single/db_backup_enroll_20261028.sql 2>/dev/null; '
                f'ls -lh /home/single/db_backup_enroll_20261028.sql | awk "{{print \\$5}}"'))

print('\n===== 2. 上传配置与脚本 =====')
sftp = cli.open_sftp()
with sftp.open(f'{REMOTE_DIR}/_enroll_cfg.json', 'w') as f:
    f.write(json.dumps(CONFIG, ensure_ascii=False, indent=1))
with sftp.open(f'{REMOTE_DIR}/_gen_enroll.js', 'w') as f:
    f.write(NODE)
sftp.close()
print('  已上传')

print('\n===== 3. 执行 =====')
print(run(f'cd {REMOTE_DIR} && node _gen_enroll.js 2>&1'))

print('\n===== 4. 清理 =====')
run(f'rm -f {REMOTE_DIR}/_gen_enroll.js {REMOTE_DIR}/_enroll_cfg.json')
print('  done')
cli.close()
