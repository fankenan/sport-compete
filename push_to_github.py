# -*- coding: utf-8 -*-
"""把 sport-compete 推到 GitHub（走内网机，本机传输层不稳）
用法：python push_to_github.py <PAT>
PAT 权限：classic token 勾选 repo（含建仓）
推送后请到 https://github.com/settings/tokens 吊销该 token
"""
import os
import sys
import time
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


PAT = sys.argv[1] if len(sys.argv) > 1 else os.environ.get('GH_PAT')
if not PAT:
    raise SystemExit('缺少 PAT：python push_to_github.py <token>')

REPO = 'sport-compete'
USER = 'fankenan'
LOCAL_BUNDLE = r'C:\Users\fanke\WorkBuddy\2026-10-16-14-13-47\sport-compete.bundle'
REMOTE_BUNDLE = 'sport-compete.bundle'

cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(_ENV['SPORT_SSH_HOST'], 22, _ENV['SPORT_SSH_USER'], _ENV['SPORT_SSH_PASSWORD'], timeout=20)


def run(cmd, t=600, show=True):
    _, o, e = cli.exec_command(cmd, timeout=t, env=_ENV)
    out = o.read().decode('utf-8', 'replace').strip()
    err = e.read().decode('utf-8', 'replace').strip()
    if show and (out or err):
        print('   ', (out or err)[:400])
    return out or err


def mask(s):
    return s.replace(PAT, '***')


print('① 上传 bundle 到服务器')
sftp = cli.open_sftp()
size = os.path.getsize(LOCAL_BUNDLE)
t0 = time.time()
sftp.put(LOCAL_BUNDLE, REMOTE_BUNDLE)
sftp.close()
print(f'    完成 {size/1024/1024:.1f} MB，用时 {time.time()-t0:.0f}s')
print('   ', run('ls -lh ~/sport-compete.bundle | awk "{print \$5}"'))

print('② 建仓（已存在会返回 422，可忽略）')
r = run(f'''curl -s -u "{USER}:{PAT}" -d '{{"name":"{REPO}","private":true,"description":"校园体育竞赛管理系统"}}' https://api.github.com/user/repos | head -c 200''', 120)
print('   ', mask(r)[:200])

print('③ 从 bundle 还原并推送')
run('rm -rf ~/scgit')
run(f'git clone -q ~/{REMOTE_BUNDLE} ~/scgit')
run('cd ~/scgit && git config user.email "fankenan@users.noreply.github.com" && git config user.name fankenan')
run('cd ~/scgit && git remote remove origin 2>/dev/null; true')
run(f'cd ~/scgit && git remote add origin https://{USER}:{PAT}@github.com/{USER}/{REPO}.git', show=False)
run('cd ~/scgit && git branch -M main', show=False)
print('   ', mask(run(f'cd ~/scgit && git push -u origin main 2>&1 | tail -5', 600)))

print('④ 验证')
print('   ', mask(run(f'cd ~/scgit && git ls-remote https://{USER}:{PAT}@github.com/{USER}/{REPO}.git | head -3', 120)))
print('   ', run(f'cd ~/scgit && git log --oneline -1'))

print('⑤ 清理服务器上的临时文件（含内嵌 token 的 .git/config）')
run('rm -rf ~/scgit ~/sport-compete.bundle', 120)
print('   ', run('ls ~ | head -8'))

cli.close()
print('\n完成。请务必去 GitHub Settings → Developer settings → Personal access tokens 吊销本次使用的 token。')
