# -*- coding: utf-8 -*-
"""部署前端：把本地 dist 同步到内网机 /home/single/sport-compete/frontend/dist"""
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
REMOTE = '/home/single/sport-compete/frontend/dist'

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


# 先建一个新目录，避免直接删旧 dist
run(f'rm -rf {REMOTE}_new && mkdir -p {REMOTE}_new')
sftp = cli.open_sftp()


local_dist = os.path.join(BASE_DIR, 'frontend', 'dist')
count = 0


def upload_dir(local, remote):
    global count
    for name in os.listdir(local):
        lp = os.path.join(local, name)
        rp = remote + '/' + name
        if os.path.isdir(lp):
            try:
                sftp.mkdir(rp)
            except IOError:
                pass
            upload_dir(lp, rp)
        else:
            sftp.put(lp, rp)
            count += 1


upload_dir(local_dist, REMOTE + '_new')
sftp.close()
print('uploaded files:', count)

# 原子切换
o, e = run(f'rm -rf {REMOTE} && mv {REMOTE}_new {REMOTE} && ls -la {REMOTE} | head -6')
print(o or e)

o, e = run('echo $SPORT_SUDO_PASSWORD | sudo -S systemctl restart sport-compete-backend && sleep 2 && systemctl is-active sport-compete-backend')
print('service:', o or e)

o, e = run('curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4100/ && echo " <- 内网首页状态码"')
print(o or e)

cli.close()

# ============================================================
# 二、同步到腾讯云（对外站点 /var/www/sport-compete）
# ============================================================
print('\n===== 同步到腾讯云 =====')
KEY = os.path.join(os.path.expanduser('~'), '.ssh', 'id_ed25519_tencent')
pub = paramiko.SSHClient()
pub.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pub.connect('150.158.39.237', 22, 'root', key_filename=KEY, timeout=20)


def prun(cmd, t=180):
    _, o, e = pub.exec_command(cmd, timeout=t)
    return o.read().decode('utf-8', 'replace').strip(), e.read().decode('utf-8', 'replace').strip()


PUB_REMOTE = '/var/www/sport-compete'
prun(f'rm -rf {PUB_REMOTE}_new && mkdir -p {PUB_REMOTE}_new')

psftp = pub.open_sftp()
count2 = 0


def upload_dir2(local, remote):
    global count2
    for name in os.listdir(local):
        lp = os.path.join(local, name)
        rp = remote + '/' + name
        if os.path.isdir(lp):
            try:
                psftp.mkdir(rp)
            except IOError:
                pass
            upload_dir2(lp, rp)
        else:
            psftp.put(lp, rp)
            count2 += 1


upload_dir2(local_dist, PUB_REMOTE + '_new')
psftp.close()
print('uploaded to tencent:', count2)

o, e = prun(f'rm -rf {PUB_REMOTE} && mv {PUB_REMOTE}_new {PUB_REMOTE} && ls {PUB_REMOTE}/assets | grep -i track')
print('新资源:', o or e)

o, e = prun('nginx -t && systemctl reload nginx && echo nginx_reloaded')
print(o or e)

pub.close()
