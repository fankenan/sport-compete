# -*- coding: utf-8 -*-
"""
按「学校账号名单.xlsx」为 51 所学校建账号，密码统一 123456。
- school 已存在的（按 name 匹配）不重复建
- user 已存在的（该 school 的 role=2）改密码 + 对齐用户名
- 不存在的才新建
"""
import io
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


BASE = os.path.dirname(os.path.abspath(__file__))
REMOTE_DIR = '/home/single/sport-compete/server'

# 序号, 学校名称, 学段, 简称, 用户名
SCHOOLS = [
    (1, '登封市颍阳镇中心小学', 1, '颍阳镇中心小学', 'yyzxxx'),
    (2, '登封市君召乡中心小学', 1, '君召乡中心小学', 'jzxzxxx'),
    (3, '登封市石道乡中心小学', 1, '石道乡中心小学', 'sdxzxxx'),
    (4, '登封市白坪镇中心小学', 1, '白坪镇中心小学', 'bpzxxx'),
    (5, '登封市白坪镇第一小学', 1, '白坪镇第一小学', 'bpzdyxx'),
    (6, '登封市大金店镇中心小学', 1, '大金店镇中心小学', 'djdzzxxx'),
    (7, '登封市唐庄镇中心小学', 1, '唐庄镇中心小学', 'tzzzxxx'),
    (8, '登封市东华镇中心小学', 1, '东华镇中心小学', 'dhzzxxx'),
    (9, '登封市大冶镇中心小学', 1, '大冶镇中心小学', 'dyzzxxx'),
    (10, '登封市博文路小学', 1, '博文路小学', 'bwlxx'),
    (11, '登封市告成镇中心小学', 1, '告成镇中心小学', 'gczzxxx'),
    (12, '登封市宣化镇中心小学', 1, '宣化镇中心小学', 'xhzzxxx'),
    (13, '登封市徐庄镇中心小学', 1, '徐庄镇中心小学', 'xzzzxxx'),
    (14, '登封市永泰路小学', 1, '永泰路小学', 'ytlxx'),
    (15, '登封市崇高路小学', 1, '崇高路小学', 'cglxx'),
    (16, '登封市汉武路小学', 1, '汉武路小学', 'hwlxx'),
    (17, '登封市昌盛路小学', 1, '昌盛路小学', 'cslxx'),
    (18, '登封市商埠街小学', 1, '商埠街小学', 'sbjxx'),
    (19, '登封市北区小学', 1, '北区小学', 'bqxx'),
    (20, '登封市书院河路小学', 1, '书院河路小学', 'syhlxx'),
    (21, '登封市通达路小学', 1, '通达路小学', 'tdlxx'),
    (22, '登封市滨河路小学', 1, '滨河路小学', 'bhlxx'),
    (23, '登封市嵩山路小学', 1, '嵩山路小学', 'sslxx'),
    (24, '登封市中岳办第二小学', 1, '中岳二小', 'zyex'),
    (25, '登封市颍阳镇初级中学', 2, '颍阳初中', 'yycz'),
    (26, '登封市君召乡初级中学', 2, '君召初中', 'jzcz'),
    (27, '登封市石道乡初级中学', 2, '石道初中', 'sdcz'),
    (28, '登封市白坪镇第一初级中学', 2, '白坪一初中', 'bpycz'),
    (29, '登封市大金店镇初级中学', 2, '大金店初中', 'djdcz'),
    (30, '登封市唐庄镇初级中学', 2, '唐庄初中', 'tzcz'),
    (31, '登封市东华镇第一初级中学', 2, '东华一初中', 'dhycz'),
    (32, '登封市直属第九初级中学', 2, '市直九初中', 'szjcz'),
    (33, '登封市告成镇初级中学', 2, '告成初中', 'gccz'),
    (34, '登封市宣化镇初级中学', 2, '宣化初中', 'xhcz'),
    (35, '登封市徐庄镇初级中学', 2, '徐庄初中', 'xzcz'),
    (36, '登封市直属第六初级中学', 2, '市直六初中', 'szlcz'),
    (37, '登封市直属第八初级中学', 2, '市直八初中', 'szbcz'),
    (38, '登封市直属第一初级中学', 2, '市直一初中', 'szycz'),
    (39, '登封市直属第一初级中学少林校区', 2, '少林初中', 'slcz'),
    (40, '登封市直属第二初级中学', 2, '市直二初中', 'szecz'),
    (41, '登封市直属第三初级中学', 2, '市直三初中', 'szscz'),
    (42, '登封市嵩阳中学', 2, '嵩阳中学', 'syzx'),
    (43, '登封市直属第五初级中学', 2, '市直五初中', 'szwcz'),
    (44, '登封市直属第七初级中学', 2, '市直七初中', 'szqcz'),
    (45, '登封新时代学校', 2, '新时代学校', 'xsdxx'),
    (46, '登封市第一高级中学', 3, '登封一中', 'dfyz'),
    (47, '登封市嵩阳高级中学', 3, '嵩阳高中', 'sygjzx'),
    (48, '登封市实验高级中学', 3, '实验高中', 'sygz'),
    (49, '登封市外国语高级中学', 3, '外国语高中', 'wgygz'),
    (50, '登封市中等专业学校', 3, '登封中专', 'dfzz'),
    (51, '登封市少林中学', 3, '少林中学', 'slzx'),
]

DATA = [{'name': n, 'stage': s, 'short_name': sn, 'username': u} for _, n, s, sn, u in SCHOOLS]

NODE = r'''
const fs = require('fs');
require('dotenv').config();   // db.js 只读 process.env，独立脚本必须自己加载 .env
const { query, queryOne, execute } = require('./db');
const { hashPassword } = require('./utils/helpers');

(async () => {
  const list = JSON.parse(fs.readFileSync('./_schools.json', 'utf8'));
  const pwd = hashPassword('123456');
  const stat = { schoolCreated: 0, schoolExisted: 0, userCreated: 0, userUpdated: 0,
                 renamed: 0, conflict: [], errors: [] };

  for (const s of list) {
    try {
      let school = await queryOne('SELECT id FROM school WHERE name = ?', [s.name]);
      let schoolId;
      if (school) {
        schoolId = school.id;
        stat.schoolExisted++;
        await execute('UPDATE school SET stage = ?, short_name = ? WHERE id = ?',
                      [s.stage, s.short_name, schoolId]);
      } else {
        const r = await execute(
          'INSERT INTO school (name, stage, short_name) VALUES (?,?,?)',
          [s.name, s.stage, s.short_name]);
        schoolId = r.insertId;
        stat.schoolCreated++;
      }

      const u = await queryOne(
        'SELECT id, username FROM user WHERE school_id = ? AND role = 2 LIMIT 1', [schoolId]);

      if (u) {
        await execute('UPDATE user SET password_hash = ?, is_active = 1 WHERE id = ?',
                      [pwd, u.id]);
        stat.userUpdated++;
        if (u.username !== s.username) {
          const dup = await queryOne('SELECT id FROM user WHERE username = ?', [s.username]);
          if (!dup) {
            await execute('UPDATE user SET username = ? WHERE id = ?', [s.username, u.id]);
            stat.renamed++;
          } else {
            stat.conflict.push({ school: s.name, want: s.username, kept: u.username, why: '用户名已被占用' });
          }
        }
      } else {
        const dup = await queryOne('SELECT id FROM user WHERE username = ?', [s.username]);
        if (dup) {
          stat.conflict.push({ school: s.name, want: s.username, why: '用户名已被其他账号占用，未建' });
          continue;
        }
        await execute(
          'INSERT INTO user (school_id, username, password_hash, real_name, role, is_active) VALUES (?,?,?,?,2,1)',
          [schoolId, s.username, pwd, s.short_name]);
        stat.userCreated++;
      }
    } catch (e) {
      stat.errors.push({ school: s.name, msg: e.message });
    }
  }

  console.log(JSON.stringify(stat, null, 1));
  const cnt = await queryOne('SELECT COUNT(*) c FROM school');
  const uc = await queryOne('SELECT COUNT(*) c FROM user WHERE role = 2');
  console.log('学校总数=' + cnt.c + '  学校账号数=' + uc.c);
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
'''

cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(_ENV['SPORT_SSH_HOST'], 22, _ENV['SPORT_SSH_USER'], _ENV['SPORT_SSH_PASSWORD'], timeout=20)


def run(cmd, t=180):
    _, o, e = cli.exec_command(cmd, timeout=t, env=_ENV)
    return o.read().decode('utf-8', 'replace').strip() or e.read().decode('utf-8', 'replace').strip()


print('===== 1. 备份当前 school / user =====')
ENV = 'cd /home/single/sport-compete/server && set -a && . ./.env 2>/dev/null; set +a;'
print(run(f'{ENV} mysqldump -u$DB_USER -p$DB_PASSWORD -h$DB_HOST --single-transaction --skip-lock-tables '
          f'$DB_NAME school user > /home/single/db_backup_accounts_20261028.sql 2>/dev/null; '
          f'ls -lh /home/single/db_backup_accounts_20261028.sql | awk "{{print \\$5}}"'))

print('\n===== 2. 上传脚本与数据 =====')
sftp = cli.open_sftp()
with sftp.open(f'{REMOTE_DIR}/_schools.json', 'w') as f:
    f.write(json.dumps(DATA, ensure_ascii=False, indent=1))
with sftp.open(f'{REMOTE_DIR}/_gen_accounts.js', 'w') as f:
    f.write(NODE)
sftp.close()
print('  _schools.json (%d 所) + _gen_accounts.js 已上传' % len(DATA))

print('\n===== 3. 执行 =====')
print(run(f'cd {REMOTE_DIR} && node _gen_accounts.js 2>&1'))

print('\n===== 4. 清理临时文件 =====')
run(f'rm -f {REMOTE_DIR}/_gen_accounts.js {REMOTE_DIR}/_schools.json')
print('  done')
cli.close()
