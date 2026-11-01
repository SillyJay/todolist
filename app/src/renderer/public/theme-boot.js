/* 首帧主题预置脚本（普通脚本，在 body 解析前执行）。
 *
 * 作用：浅色模式用户重开软件时，不再先黑一屏再变白。
 * React 启动前就把 .light 挂到 <html>/<body> 上，并让页面底色立刻正确。
 *
 * 注意：必须放在 index.html 的 <head> 里、且是普通 script（不能是 module），
 * 否则会晚于首帧执行，起不到作用。
 */
;(function () {
  var light = false
  try {
    light = localStorage.getItem('ca_theme') === 'light'
  } catch (e) {
    light = false
  }
  if (!light) return

  document.documentElement.classList.add('light')
  document.documentElement.style.background = '#f7f8fa'
  document.documentElement.style.colorScheme = 'light'

  var applyBody = function () {
    if (document.body) {
      document.body.classList.add('light')
      document.body.style.background = '#f7f8fa'
    }
  }
  applyBody()
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyBody)
  }
})()
