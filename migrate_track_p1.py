# -*- coding: utf-8 -*-
"""第一期：执行田径数据底座迁移 + 模板种子"""
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
HOST = _ENV['SPORT_SSH_HOST']
USER = _ENV['SPORT_SSH_USER']
PWD  = _ENV['SPORT_SSH_PASSWORD']
REMOTE = '/home/single/sport-compete'

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

def run(cmd, t=180):
    _, o, e = cli.exec_command(cmd, timeout=t, env=_ENV)
    return o.read().decode('utf-8', 'replace').strip(), e.read().decode('utf-8', 'replace').strip()


run(f'mkdir -p {REMOTE}/sql')

sftp = cli.open_sftp()
for f in ['sql/migrate_track_phase1.sql', 'sql/seed_track_template.sql']:
    sftp.put(os.path.join(BASE_DIR, f), f'{REMOTE}/{f}')
    print('uploaded:', f)
sftp.close()

CMD = 'mysql -ucompete -p$SPORT_DB_PASSWORD sport_compete'

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
