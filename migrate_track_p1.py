# -*- coding: utf-8 -*-
"""第一期：执行田径数据底座迁移 + 模板种子"""
import os
import paramiko

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
HOST, USER, PWD = '10.128.1.45', 'single', 'jyj2026'
REMOTE = '/home/single/sport-compete'

cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(HOST, 22, USER, PWD, timeout=15)


def run(cmd, t=180):
    _, o, e = cli.exec_command(cmd, timeout=t)
    return o.read().decode('utf-8', 'replace').strip(), e.read().decode('utf-8', 'replace').strip()


run(f'mkdir -p {REMOTE}/sql')

sftp = cli.open_sftp()
for f in ['sql/migrate_track_phase1.sql', 'sql/seed_track_template.sql']:
    sftp.put(os.path.join(BASE_DIR, f), f'{REMOTE}/{f}')
    print('uploaded:', f)
sftp.close()

CMD = 'mysql -ucompete -pCompete@2026 sport_compete'

print('\n===== 迁移前状态 =====')
o, e = run(f'{CMD} -e "DESC competition;" | head -5')
print(o or e)

print('\n===== 执行结构迁移 =====')
o, e = run(f'cd {REMOTE} && {CMD} < sql/migrate_track_phase1.sql 2>&1')
print('OUT:', o)
print('ERR:', e)

print('\n===== 执行模板种子 =====')
o, e = run(f'cd {REMOTE} && {CMD} < sql/seed_track_template.sql 2>&1')
print('OUT:', o)
print('ERR:', e)

print('\n===== 迁移后校验 =====')
o, e = run(f'''{CMD} -e "
SELECT COUNT(*) AS 模板数 FROM event_template;
SELECT COUNT(*) AS 评分公式数 FROM score_table;
SELECT event_type, COUNT(*) c FROM event_template GROUP BY event_type;
SELECT COUNT(*) AS 全能子项数 FROM event_template WHERE combined_parent_id > 0;
"''')
print(o or e)

o, e = run(f'''{CMD} -e "
SHOW COLUMNS FROM event_item LIKE 'result%';
SHOW COLUMNS FROM group_band LIKE '%max%';
SELECT uuid, meet_level, minimum_rest_minutes, tie_score_mode FROM competition LIMIT 3;
"''')
print(o or e)

cli.close()
