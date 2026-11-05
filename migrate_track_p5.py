# -*- coding: utf-8 -*-
"""执行第四期表结构迁移"""
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


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(_ENV['SPORT_SSH_HOST'], 22, _ENV['SPORT_SSH_USER'], _ENV['SPORT_SSH_PASSWORD'], timeout=15)


def run(cmd, t=180):
    _, o, e = cli.exec_command(cmd, timeout=t, env=_ENV)
    return o.read().decode('utf-8', 'replace').strip(), e.read().decode('utf-8', 'replace').strip()


run('mkdir -p /home/single/sport-compete/sql')
sftp = cli.open_sftp()
sftp.put(os.path.join(BASE_DIR, 'sql', 'migrate_track_phase5.sql').replace('\\', '/'),
         '/home/single/sport-compete/sql/migrate_track_phase5.sql')
sftp.close()

o, e = run("""mysql -ucompete -pprocess.env.SPORT_DB_PASSWORD sport_compete < /home/single/sport-compete/sql/migrate_track_phase5.sql 2>&1 | grep -v Warning""")
print(o or e)

o, e = run("""mysql -ucompete -pprocess.env.SPORT_DB_PASSWORD sport_compete -e "SHOW TABLES LIKE 'team_score%'; SHOW TABLES LIKE 'screen_config'; DESC team_score_total;" 2>&1 | grep -v Warning""")
print(o or e)

cli.close()
