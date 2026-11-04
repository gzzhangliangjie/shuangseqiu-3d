/* 微信小游戏入口 —— 加载顺序不可调换：
   1) adapter：先造好 document / canvas / 触摸 / 时间 / 音频环境
   2) hud：注册 GameGlobal.__hud（供主逻辑叠加绘制、供 adapter 判定按钮命中）
   3) game-logic：由 build.js 从 index.html 抽出的 Web 端同一份 3D 主逻辑
*/
require('./adapter.js');
require('./hud.js');
require('./src/game-logic.js');
