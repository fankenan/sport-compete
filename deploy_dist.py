# -*- coding: utf-8 -*-
"""
只部署前端 dist 到两处（内网机 + 腾讯云），不改后端。
用法：python deploy_dist.py
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
LOCAL_DIST = os.path.join(BASE, 'frontend', 'dist')


def upload_tree(sftp, local, remote, counter):
    for name in os.listdir(local):
        lp = os.path.join(local, name)
        rp = remote + '/' + name
        if os.path.isdir(lp):
            try:
                sftp.mkdir(rp)
            except IOError:
                pass
            upload_tree(sftp, lp, rp, counter)
        else:
            sftp.put(lp, rp)
            counter[0] += 1


print('===== 1. 内网机 10.128.1.45 =====')
REMOTE = '/home/single/sport-compete/frontend'
cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(_ENV['SPORT_SSH_HOST'], 22, _ENV['SPORT_SSH_USER'], _ENV['SPORT_SSH_PASSWORD'], timeout=15)


def run(cmd, t=300):
    _, o, e = cli.exec_command(cmd, timeout=t, env=_ENV)
    return o.read().decode('utf-8', 'replace').strip() or e.read().decode('utf-8', 'replace').strip()


run(f'rm -rf {REMOTE}/dist_new && mkdir -p {REMOTE}/dist_new')
sftp = cli.open_sftp()
c = [0]
upload_tree(sftp, LOCAL_DIST, f'{REMOTE}/dist_new', c)
sftp.close()
print('  uploaded:', c[0])
run(f'rm -rf {REMOTE}/dist && mv {REMOTE}/dist_new {REMOTE}/dist')
print('  文件数:', run(f'ls {REMOTE}/dist | wc -l'))
print('  favicon:', run(f'md5sum {REMOTE}/dist/favicon.svg | cut -c1-12'))
print('  服务:', run('systemctl is-active sport-compete-backend'))
print('  http:', run('curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4100/'))
cli.close()

print('\n===== 2. 腾讯云 150.158.39.237 =====')
KEY = os.path.join(os.path.expanduser('~'), '.ssh', 'id_ed25519_tencent')
PUB_PATH = '/var/www/sport-compete'
pub = paramiko.SSHClient()
pub.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pub.connect('150.158.39.237', 22, 'root', key_filename=KEY, timeout=20)


def prun(cmd, t=300):
    _, o, e = pub.exec_command(cmd, timeout=t)
    return o.read().decode('utf-8', 'replace').strip() or e.read().decode('utf-8', 'replace').strip()


prun(f'rm -rf {PUB_PATH}_new && mkdir -p {PUB_PATH}_new')
psftp = pub.open_sftp()
c2 = [0]
upload_tree(psftp, LOCAL_DIST, PUB_PATH + '_new', c2)
psftp.close()
print('  uploaded:', c2[0])
prun(f'rm -rf {PUB_PATH} && mv {PUB_PATH}_new {PUB_PATH}')
print('  favicon:', prun(f'md5sum {PUB_PATH}/favicon.svg | cut -c1-12'))
print('  nginx:', prun('nginx -t 2>&1 | tail -1 && systemctl reload nginx && echo reloaded'))
print('  http:', prun('curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8083/'))
pub.close()

print('\n===== 完成（两处 favicon 的 md5 应一致）=====')
