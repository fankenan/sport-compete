# -*- coding: utf-8 -*-
"""部署后端：entry.js / badgePdf.js / rosterPdf.js / helpers.js → 10.128.1.45，重启服务"""
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


os.chdir(os.path.dirname(os.path.abspath(__file__)))

HOST = _ENV['SPORT_SSH_HOST']
USER = _ENV['SPORT_SSH_USER']
PWD  = _ENV['SPORT_SSH_PASSWORD']
BASE = '/home/single/sport-compete/server'

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

def run(cmd):
    _, out, err = cli.exec_command(cmd, timeout=60, env=_ENV)
    o = out.read().decode('utf-8', 'replace').strip()
    e = err.read().decode('utf-8', 'replace').strip()
    return o, e

# 1. 上传文件
sftp = cli.open_sftp()
files = [
    ('server/routes/entry.js', f'{BASE}/routes/entry.js'),
    ('server/services/badgePdf.js', f'{BASE}/services/badgePdf.js'),
    ('server/services/rosterPdf.js', f'{BASE}/services/rosterPdf.js'),
    ('server/utils/helpers.js', f'{BASE}/utils/helpers.js'),
]
for local, remote in files:
    sftp.put(local, remote)
    print('uploaded:', remote)

# 2. 字体确认（没有就传）
o, _ = run(f'ls {BASE}/fonts/ 2>/dev/null')
print('server fonts:', o or '(none)')
if 'deng.ttf' not in o:
    run(f'mkdir -p {BASE}/fonts')
    sftp.put('server/fonts/deng.ttf', f'{BASE}/fonts/deng.ttf')
    sftp.put('server/fonts/deng_bold.ttf', f'{BASE}/fonts/deng_bold.ttf')
    print('fonts uploaded')

# 3. pdfkit 确认
o, e = run(f'cd {BASE} && node -e "require(\'pdfkit\'); console.log(\'pdfkit ok\')"')
print('pdfkit check:', o or e)
sftp.close()

# 4. 语法检查 + 重启
o, e = run(f'node --check {BASE}/routes/entry.js && echo SYNTAX_OK')
print('syntax:', o or e)
o, e = run('echo $SPORT_SUDO_PASSWORD | sudo -S systemctl restart sport-compete-backend && sleep 2 && systemctl is-active sport-compete-backend')
print('service:', o or e)

cli.close()
print('DEPLOY DONE')
