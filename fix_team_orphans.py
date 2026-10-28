# -*- coding: utf-8 -*-
"""
1) 清理赛事6 的孤儿 team_entry（指向已删除的组别/项目）
2) 补齐赛事6 缺失的 2 所高中男子队（中专、少林中学）
3) 统一赛事7 组别 label（'A' → '初中男子'）
先备份再执行，每步都打印结果。
"""
import os
import paramiko

BASE = os.path.dirname(os.path.abspath(__file__))
REMOTE_DIR = '/home/single/sport-compete/server'

NODE = r'''
require('dotenv').config();
const { query, queryOne, execute } = require('./db');

(async () => {
  console.log('--- 1. 赛事6 孤儿报名清单 ---');
  const orphans = await query(`
    SELECT te.id, te.band_id, te.event_item_id, te.school_id, s.name, te.team_name
    FROM team_entry te
    LEFT JOIN group_band gb ON gb.id = te.band_id
    LEFT JOIN event_item ei ON ei.id = te.event_item_id
    LEFT JOIN school s ON s.id = te.school_id
    WHERE te.competition_id = 6 AND (gb.id IS NULL OR ei.id IS NULL)
    ORDER BY te.id`);
  for (const o of orphans) {
    console.log(`  id=${o.id} band=${o.band_id} item=${o.event_item_id} ${o.name || '(学校?)'} ${o.team_name || ''}`);
  }
  if (orphans.length) {
    const ids = orphans.map(o => o.id).join(',');
    await execute(`DELETE FROM team_entry WHERE id IN (${ids})`);
    console.log(`  已删除 ${orphans.length} 条`);
  } else {
    console.log('  无孤儿');
  }

  console.log('\n--- 2. 补齐赛事6 男子队 ---');
  const band6M = await queryOne('SELECT id FROM group_band WHERE competition_id=6 AND gender=1 LIMIT 1');
  const item6 = await queryOne('SELECT id FROM event_item WHERE competition_id=6 LIMIT 1');
  const seniors = await query("SELECT id, name, short_name FROM school WHERE stage=3 ORDER BY id");
  for (const s of seniors) {
    const dup = await queryOne(
      'SELECT id FROM team_entry WHERE band_id=? AND event_item_id=? AND school_id=?',
      [band6M.id, item6.id, s.id]);
    if (dup) { console.log(`  ${s.short_name} 已有，跳过`); continue; }
    await execute(
      'INSERT INTO team_entry (competition_id, band_id, event_item_id, school_id, team_name, leader_name, coach_name, status) VALUES (?,?,?,?,?,?,?,1)',
      [6, band6M.id, item6.id, s.id, s.short_name + '代表队', s.short_name + '领队', '教练' + s.short_name.slice(0, 2)]);
    console.log(`  + ${s.short_name}代表队`);
  }

  console.log('\n--- 3. 统一赛事7 组别 label ---');
  const b7m = await queryOne('SELECT id, label FROM group_band WHERE competition_id=7 AND gender=1 LIMIT 1');
  if (b7m && b7m.label !== '初中男子') {
    await execute('UPDATE group_band SET label=? WHERE id=?', ['初中男子', b7m.id]);
    console.log(`  组别 ${b7m.id}: '${b7m.label}' → '初中男子'`);
  } else {
    console.log('  无需修改');
  }

  console.log('\n===== 最终核对 =====');
  const rows = await query(`
    SELECT c.id cid, c.name, gb.label, COUNT(*) cnt
    FROM team_entry te
    JOIN competition c ON c.id = te.competition_id
    LEFT JOIN group_band gb ON gb.id = te.band_id
    WHERE te.competition_id IN (2,6,7)
    GROUP BY c.id, gb.id ORDER BY c.id, gb.sort_no`);
  let last = null;
  for (const r of rows) {
    if (r.cid !== last) { console.log(`  赛事${r.cid} ${r.name}`); last = r.cid; }
    console.log(`    ${r.label || '(未命名)'}  ${r.cnt} 队`);
  }
  const orphanAll = await queryOne(`
    SELECT COUNT(*) c FROM team_entry te
    LEFT JOIN group_band gb ON gb.id=te.band_id
    LEFT JOIN event_item ei ON ei.id=te.event_item_id
    WHERE gb.id IS NULL OR ei.id IS NULL`);
  console.log('  全库孤儿 team_entry:', orphanAll.c);
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
'''

cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect('10.128.1.45', 22, 'single', 'jyj2026', timeout=20)


def run(cmd, t=300):
    _, o, e = cli.exec_command(cmd, timeout=t)
    out = o.read().decode('utf-8', 'replace').strip()
    err = e.read().decode('utf-8', 'replace').strip()
    return (out + ('\n' + err if err else '')).strip()


ENV = 'cd /home/single/sport-compete/server && set -a && . ./.env 2>/dev/null; set +a;'
print('===== 备份 team_entry =====')
print('  ' + run(f'{ENV} mysqldump -u$DB_USER -p$DB_PASSWORD -h$DB_HOST --single-transaction --skip-lock-tables '
                f'$DB_NAME team_entry group_band > /home/single/db_backup_teamfix_20261028.sql 2>/dev/null; '
                f'ls -lh /home/single/db_backup_teamfix_20261028.sql | awk "{{print \\$5}}"'))

sftp = cli.open_sftp()
with sftp.open(f'{REMOTE_DIR}/_fix_team.js', 'w') as f:
    f.write(NODE)
sftp.close()

print('\n===== 执行 =====')
print(run(f'cd {REMOTE_DIR} && node _fix_team.js 2>&1'))
run(f'rm -f {REMOTE_DIR}/_fix_team.js')
cli.close()
