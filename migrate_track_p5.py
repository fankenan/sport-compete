# -*- coding: utf-8 -*-
"""执行第四期表结构迁移"""
import os
import paramiko

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect('10.128.1.45', 22, 'single', 'jyj2026', timeout=15)


def run(cmd, t=180):
    _, o, e = cli.exec_command(cmd, timeout=t)
    return o.read().decode('utf-8', 'replace').strip(), e.read().decode('utf-8', 'replace').strip()


run('mkdir -p /home/single/sport-compete/sql')
sftp = cli.open_sftp()
sftp.put(os.path.join(BASE_DIR, 'sql', 'migrate_track_phase5.sql').replace('\\', '/'),
         '/home/single/sport-compete/sql/migrate_track_phase5.sql')
sftp.close()

o, e = run("""mysql -ucompete -p'Compete@2026' sport_compete < /home/single/sport-compete/sql/migrate_track_phase5.sql 2>&1 | grep -v Warning""")
print(o or e)

o, e = run("""mysql -ucompete -p'Compete@2026' sport_compete -e "SHOW TABLES LIKE 'team_score%'; SHOW TABLES LIKE 'screen_config'; DESC team_score_total;" 2>&1 | grep -v Warning""")
print(o or e)

cli.close()
