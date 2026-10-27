/**
 * 统一 UI 交互封装（底层全部使用 TDesign）
 * 目的：页面里不用重复写 DialogPlugin 的模板代码
 */
import { MessagePlugin, DialogPlugin, NotifyPlugin } from 'tdesign-vue-next';

/* ---------- 消息提示 ---------- */
export const message = {
  success(msg, duration) {
    MessagePlugin.success({ content: msg, duration });
  },
  error(msg, duration) {
    // 长文案（如带排查指引的错误）多显示一会儿，避免用户没看清就消失
    const len = String(msg || '').length;
    const d = duration ?? (len > 40 ? 9000 : 3500);
    MessagePlugin.error({ content: msg, duration: d });
  },
  warning(msg, duration) {
    MessagePlugin.warning({ content: msg, duration });
  },
  info(msg, duration) {
    MessagePlugin.info({ content: msg, duration });
  }
};

/* ---------- 确认框 ---------- */
/**
 * @returns {Promise<void>} 确认 resolve，取消 reject
 */
export function confirm(content, title = '提示', options = {}) {
  return new Promise((resolve, reject) => {
    const dlg = DialogPlugin.confirm({
      header: title,
      body: typeof content === 'string' ? content : String(content ?? ''),
      theme: options.theme || 'warning',
      confirmBtn: options.confirmBtn || '确定',
      cancelBtn: options.cancelBtn || '取消',
      onConfirm: () => {
        dlg.hide();
        resolve();
      },
      onCancel: () => {
        dlg.hide();
        reject(new Error('cancel'));
      },
      onClose: () => {
        dlg.hide();
        reject(new Error('cancel'));
      }
    });
  });
}

/* ---------- 提示框（单按钮） ---------- */
export function alert(content, title = '提示', options = {}) {
  return new Promise((resolve) => {
    const dlg = DialogPlugin.alert({
      header: title,
      body: typeof content === 'string' ? content : String(content ?? ''),
      theme: options.theme || 'info',
      confirmBtn: options.confirmBtn || '知道了',
      onConfirm: () => {
        dlg.hide();
        resolve();
      },
      onClose: () => {
        dlg.hide();
        resolve();
      }
    });
  });
}

/* ---------- 带输入框的提示 ---------- */
export function prompt(options = {}) {
  return new Promise((resolve, reject) => {
    const dlg = DialogPlugin({
      header: options.title || '请输入',
      body: options.content || '',
      theme: 'info',
      confirmBtn: '确定',
      cancelBtn: '取消',
      onConfirm: () => {
        dlg.hide();
        resolve(options.defaultValue || '');
      },
      onCancel: () => {
        dlg.hide();
        reject(new Error('cancel'));
      },
      onClose: () => {
        dlg.hide();
        reject(new Error('cancel'));
      }
    });
  });
}

/* ---------- 右上角通知 ---------- */
export const notify = {
  success(msg, title = '成功') {
    NotifyPlugin.success({ title, content: msg });
  },
  error(msg, title = '出错了') {
    NotifyPlugin.error({ title, content: msg });
  },
  warning(msg, title = '注意') {
    NotifyPlugin.warning({ title, content: msg });
  },
  info(msg, title = '提示') {
    NotifyPlugin.info({ title, content: msg });
  }
};
