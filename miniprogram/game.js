/* 微信小游戏入口 —— 加载顺序不可调换：
   1) adapter    先造好 document / canvas / 触摸 / 时间 / 音频 / wx storage 环境
   2) ssq-data   2083 期历史开奖（SimLog 形态评估与选号算法的共同数据源）
   3) simlog     3D 开奖记录 + 8 项形态评估（Web 版同一份逻辑）
   4) hud        UI 表面（一张离屏画布 / CanvasTexture）+ 开奖页 HUD
   5) pages      选号 / 分布 / 记录页，注册 GameGlobal.__ui
   6) game-logic 由 build.js 从 index.html 抽出的 3D 主逻辑
*/
require('./adapter.js');
require('./libs/ssq-data.js');
require('./src/simlog.js');
require('./hud.js');
require('./pages.js');

/* 可选：连局域网 PC 上的 node picker/sim_server.js 同步开奖结果。
   需在微信开发者工具里关闭「不校验合法域名」，并把地址改成 PC 的局域网 IP。
   默认 false = 纯本地，不依赖任何服务。
   GameGlobal.__SIM_REMOTE = true;
   GameGlobal.__SIM_BASE = 'http://192.168.1.10:8731'; */

require('./src/game-logic.js');
