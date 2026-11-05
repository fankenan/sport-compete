# -*- coding: utf-8 -*-
"""
清理 schedule_slot 重复槽（同 competition + play_date + venue_id + start_time 多于一条）
保留规则：优先保留挂了比赛的槽；都没比赛则保留 id 最小
被删槽上的比赛会先迁到保留槽
清理完加唯一索引，防止再次产生
"""
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

NODE = r'''
require('dotenv').config();
const { query, execute } = require('./db');

(async () => {
  const dups = await query(`
    SELECT competition_id, play_date, venue_id,
           TIME_FORMAT(start_time, '%H:%i:%s') AS st, COUNT(*) AS c
    FROM schedule_slot
    GROUP BY competition_id, play_date, venue_id, TIME_FORMAT(start_time, '%H:%i:%s')
    HAVING c > 1
    ORDER BY competition_id, play_date`);

  console.log('重复组数:', dups.length);
  let deleted = 0, moved = 0;

  for (const d of dups) {
    const rows = await query(
      `SELECT ss.id,
              (SELECT COUNT(*) FROM match_info mi WHERE mi.slot_id = ss.id) AS used
       FROM schedule_slot ss
       WHERE ss.competition_id = ? AND ss.play_date = ? AND ss.venue_id = ?
         AND TIME_FORMAT(ss.start_time, '%H:%i:%s') = ?
       ORDER BY used DESC, ss.id ASC`,
      [d.competition_id, d.play_date, d.venue_id, d.st]);
    const keep = rows[0].id;
    const drop = rows.slice(1).map((r) => r.id);
    if (!drop.length) continue;

    const mv = await execute(
      `UPDATE match_info SET slot_id = ? WHERE slot_id IN (${drop.join(',')})`, [keep]);
    if (mv && mv.affectedRows) moved += mv.affectedRows;

    await execute(`DELETE FROM schedule_slot WHERE id IN (${drop.join(',')})`);
    deleted += drop.length;
  }

  console.log('删除重复槽:', deleted, ' 迁移比赛:', moved);

  // 复核
  const left = await query(`
    SELECT COUNT(*) c FROM (
      SELECT 1 FROM schedule_slot
      GROUP BY competition_id, play_date, venue_id, TIME_FORMAT(start_time,'%H:%i:%s')
      HAVING COUNT(*) > 1) t`);
  console.log('剩余重复组:', left[0].c);

  const total = await query('SELECT competition_id, COUNT(*) c FROM schedule_slot GROUP BY competition_id');
  console.log('各赛事槽位总数:', JSON.stringify(total));
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
'''

cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(_ENV['SPORT_SSH_HOST'], 22, _ENV['SPORT_SSH_USER'], _ENV['SPORT_SSH_PASSWORD'], timeout=20)


def run(cmd, t=300):
    _, o, e = cli.exec_command(cmd, timeout=t, env=_ENV)
    out = o.read().decode('utf-8', 'replace').strip()
    err = e.read().decode('utf-8', 'replace').strip()
    return (out + ('\n' + err if err else '')).strip()


ENV = 'cd /home/single/sport-compete/server && set -a && . ./.env 2>/dev/null; set +a;'

print('===== 1. 备份 =====')
print('  ' + run(f'{ENV} mysqldump -u$DB_USER -p$DB_PASSWORD -h$DB_HOST --single-transaction --skip-lock-tables '
                f'$DB_NAME schedule_slot match_info > /home/single/db_backup_slotfix_20261028.sql 2>/dev/null; '
                f'ls -lh /home/single/db_backup_slotfix_20261028.sql | awk "{{print \\$5}}"'))

print('\n===== 2. 清理重复 =====')
sftp = cli.open_sftp()
with sftp.open(f'{REMOTE_DIR}/_fix_slots.js', 'w') as f:
    f.write(NODE)
sftp.close()
print(run(f'cd {REMOTE_DIR} && node _fix_slots.js 2>&1'))

print('\n===== 3. 加唯一索引 =====')
sql = ('ALTER TABLE schedule_slot '
       'ADD UNIQUE KEY uk_slot_time (competition_id, play_date, venue_id, start_time)')
print('  ' + run(f'{ENV} mysql -u$DB_USER -p$DB_PASSWORD -h$DB_HOST $DB_NAME -e "{sql}" 2>&1 | grep -v Warning')
      or '  已加唯一索引 uk_slot_time')

print('\n===== 4. 确认索引 =====')
print(run(f'{ENV} mysql -u$DB_USER -p$DB_PASSWORD -h$DB_HOST $DB_NAME -N -B '
          f'-e "SHOW INDEX FROM schedule_slot WHERE Key_name=\'uk_slot_time\'" 2>&1 | grep -v Warning'))

run(f'rm -f {REMOTE_DIR}/_fix_slots.js')
cli.close()
