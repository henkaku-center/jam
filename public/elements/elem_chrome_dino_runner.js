const STATE_VERSION = 'chrome-dino-runner-v1';

// Chrome Dino sprite sheet from Chromium. Copyright 2021 The Chromium Authors.
// Used under Chromium's BSD-style license.
const CHROMIUM_DINO_SPRITE =
  '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';

const DESIGN = {width: 600, height: 150, ground: 127};
const TREX = {x: 848, y: 2, width: 44, height: 47, duckWidth: 59};
const FRAMES = {
  wait: [44, 0],
  run: [88, 132],
  jump: [0],
  crash: [220],
  duck: [264, 323]
};
const SPRITES = {
  horizon: {x: 2, y: 54, width: 600, height: 12},
  restart: {x: 2, y: 68, width: 36, height: 32},
  cloud: {x: 86, y: 2, width: 46, height: 14},
  smallCactus: {x: 228, y: 2, width: 17, height: 35},
  largeCactus: {x: 332, y: 2, width: 25, height: 50},
  pterodactyl: {x: 134, y: 2, width: 46, height: 40}
};

const BOXES = {
  running: [
    {x: 22, y: 0, width: 17, height: 16},
    {x: 1, y: 18, width: 30, height: 9},
    {x: 1, y: 24, width: 29, height: 5},
    {x: 5, y: 30, width: 21, height: 4},
    {x: 9, y: 34, width: 15, height: 9}
  ],
  ducking: [{x: 1, y: 18, width: 55, height: 25}],
  smallCactus: [
    {x: 0, y: 7, width: 5, height: 27},
    {x: 4, y: 0, width: 6, height: 34},
    {x: 10, y: 4, width: 7, height: 14}
  ],
  largeCactus: [
    {x: 0, y: 12, width: 7, height: 38},
    {x: 8, y: 0, width: 7, height: 49},
    {x: 13, y: 10, width: 10, height: 38}
  ],
  pterodactyl: [
    {x: 15, y: 15, width: 16, height: 5},
    {x: 18, y: 21, width: 24, height: 6},
    {x: 2, y: 14, width: 4, height: 3},
    {x: 6, y: 10, width: 4, height: 7},
    {x: 10, y: 8, width: 6, height: 9}
  ]
};

export default function setup(ctx, prevState) {
  const state = {
    version: STATE_VERSION,
    highScore: Number.isFinite(prevState?.highScore) ? prevState.highScore : 0
  };

  ctx.domRoot.innerHTML = `
    <style>
      :host {
        display: block;
        width: 100%;
        height: 100%;
        background: transparent;
      }
      .dino-shell {
        position: relative;
        width: 100%;
        height: 100%;
        min-width: 260px;
        min-height: 120px;
        overflow: hidden;
        background: transparent;
        outline: none;
      }
      canvas {
        display: block;
        width: 100%;
        height: 100%;
        image-rendering: pixelated;
        image-rendering: crisp-edges;
      }
    </style>
    <div class="dino-shell" tabindex="0">
      <canvas id="dino" aria-label="Transparent Chrome dinosaur runner"></canvas>
    </div>
  `;

  const shell = ctx.domRoot.querySelector('.dino-shell');
  const canvas = ctx.domRoot.querySelector('#dino');
  const g = canvas.getContext('2d', {alpha: true});
  const sprite = new Image();
  sprite.decoding = 'async';
  sprite.src = `data:image/png;base64,${CHROMIUM_DINO_SPRITE}`;

  const game = makeGame(state.highScore);
  let raf = 0;
  let lastTime = performance.now();
  let destroyed = false;
  let fitted = {scale: 1, x: 0, y: 0};

  const random = (min, max) => min + Math.random() * (max - min);

  const resize = () => {
    const rect = shell.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const width = Math.max(1, Math.floor(rect.width * dpr));
    const height = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const cssWidth = width / dpr;
    const cssHeight = height / dpr;
    const scale = Math.max(0.5, Math.floor(Math.min(cssWidth / DESIGN.width, cssHeight / DESIGN.height) * 2) / 2);
    fitted = {
      scale,
      x: Math.round((cssWidth - DESIGN.width * scale) * 0.5),
      y: Math.round((cssHeight - DESIGN.height * scale) * 0.5)
    };
  };

  const resetRun = () => {
    game.started = true;
    game.crashed = false;
    game.speed = 6;
    game.score = 0;
    game.distance = 0;
    game.groundOffset = 0;
    game.player.y = game.player.groundY;
    game.player.vy = 0;
    game.player.ducking = false;
    game.player.jumping = false;
    game.obstacles.length = 0;
    game.clouds = makeClouds();
    game.nextGap = 80;
  };

  const jump = () => {
    if (game.crashed) {
      resetRun();
      return;
    }
    game.started = true;
    if (!game.player.jumping) {
      game.player.vy = -10;
      game.player.jumping = true;
      game.player.ducking = false;
    }
  };

  const duck = (enabled) => {
    if (game.crashed) {
      return;
    }
    game.player.ducking = enabled && !game.player.jumping;
    if (enabled && game.player.jumping) {
      game.player.vy += 1.7;
    }
  };

  const onKeyDown = (event) => {
    if (event.repeat) {
      return;
    }
    if (event.code === 'Space' || event.code === 'ArrowUp' || event.code === 'KeyW') {
      event.preventDefault();
      jump();
    } else if (event.code === 'ArrowDown' || event.code === 'KeyS') {
      event.preventDefault();
      duck(true);
    }
  };

  const onKeyUp = (event) => {
    if (event.code === 'ArrowDown' || event.code === 'KeyS') {
      event.preventDefault();
      duck(false);
    }
  };

  const onPointerDown = (event) => {
    event.preventDefault();
    shell.focus();
    jump();
  };

  const update = (dt) => {
    const frames = Math.min(2.8, dt / (1000 / 60));
    if (!game.started || game.crashed) {
      game.blink += dt;
      return;
    }

    game.time += dt;
    game.distance += game.speed * frames;
    game.score = Math.floor(game.distance * 0.04);
    game.highScore = Math.max(game.highScore, game.score);
    state.highScore = game.highScore;
    game.speed = Math.min(13.5, game.speed + 0.0017 * frames);
    game.groundOffset = (game.groundOffset + game.speed * frames) % 600;

    const player = game.player;
    if (player.jumping) {
      player.y += player.vy * frames;
      player.vy += 0.6 * frames;
      if (player.y >= player.groundY) {
        player.y = player.groundY;
        player.vy = 0;
        player.jumping = false;
      }
    }

    for (const cloud of game.clouds) {
      cloud.x -= 0.28 * frames;
      if (cloud.x < -SPRITES.cloud.width) {
        cloud.x = DESIGN.width + random(20, 140);
        cloud.y = random(20, 58);
      }
    }

    if (game.obstacles.length === 0 || game.obstacles[game.obstacles.length - 1].x < DESIGN.width - game.nextGap) {
      game.obstacles.push(makeObstacle(game.score));
      game.nextGap = random(130, 250) + game.speed * random(8, 18);
    }

    for (const obstacle of game.obstacles) {
      obstacle.x -= (game.speed + obstacle.speedOffset) * frames;
      if (obstacle.type === 'pterodactyl') {
        obstacle.anim += dt;
      }
    }
    while (game.obstacles[0] && game.obstacles[0].x + game.obstacles[0].width < -10) {
      game.obstacles.shift();
    }

    if (game.obstacles.some((obstacle) => collides(game.player, obstacle))) {
      game.crashed = true;
      game.player.ducking = false;
    }
  };

  const drawSprite = (source, sx, sy, sw, sh, dx, dy, dw = sw, dh = sh) => {
    if (!sprite.complete || !sprite.naturalWidth) {
      return;
    }
    g.drawImage(sprite, source.x + sx, source.y + sy, sw, sh, dx, dy, dw, dh);
  };

  const drawText = (text, x, y, align = 'right') => {
    g.save();
    g.fillStyle = '#535353';
    g.font = '10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    g.textAlign = align;
    g.textBaseline = 'top';
    g.fillText(text, x, y);
    g.restore();
  };

  const render = () => {
    resize();
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.imageSmoothingEnabled = false;
    g.setTransform(dpr * fitted.scale, 0, 0, dpr * fitted.scale, dpr * fitted.x, dpr * fitted.y);

    if (sprite.complete && sprite.naturalWidth) {
      for (const cloud of game.clouds) {
        drawSprite(SPRITES.cloud, 0, 0, SPRITES.cloud.width, SPRITES.cloud.height, cloud.x, cloud.y);
      }

      const horizonX = -Math.floor(game.groundOffset);
      drawSprite(SPRITES.horizon, 0, 0, SPRITES.horizon.width, SPRITES.horizon.height, horizonX, DESIGN.ground);
      drawSprite(SPRITES.horizon, 0, 0, SPRITES.horizon.width, SPRITES.horizon.height, horizonX + SPRITES.horizon.width, DESIGN.ground);

      for (const obstacle of game.obstacles) {
        drawObstacle(obstacle);
      }

      drawTrex();

      if (game.crashed) {
        drawSprite(SPRITES.restart, 0, 0, SPRITES.restart.width, SPRITES.restart.height, 282, 54);
      }
    }

    drawText(String(game.score).padStart(5, '0'), DESIGN.width - 12, 10);
    if (game.highScore > 0) {
      drawText(`HI ${String(game.highScore).padStart(5, '0')}`, DESIGN.width - 72, 10);
    }
  };

  const drawTrex = () => {
    const player = game.player;
    let frames = FRAMES.run;
    let width = TREX.width;
    if (game.crashed) {
      frames = FRAMES.crash;
    } else if (player.ducking) {
      frames = FRAMES.duck;
      width = TREX.duckWidth;
    } else if (player.jumping) {
      frames = FRAMES.jump;
    } else if (!game.started) {
      frames = FRAMES.wait;
    }
    const frame = frames[Math.floor(game.time / (player.ducking ? 125 : 84)) % frames.length];
    drawSprite(TREX, frame, 0, width, TREX.height, player.x, player.y, width, TREX.height);
  };

  const drawObstacle = (obstacle) => {
    if (obstacle.type === 'pterodactyl') {
      const frame = Math.floor(obstacle.anim / 165) % 2;
      drawSprite(SPRITES.pterodactyl, frame * SPRITES.pterodactyl.width, 0, SPRITES.pterodactyl.width, SPRITES.pterodactyl.height, obstacle.x, obstacle.y);
      return;
    }
    const spriteDef = obstacle.type === 'largeCactus' ? SPRITES.largeCactus : SPRITES.smallCactus;
    const sourceX = spriteDef.width * obstacle.size * (0.5 * (obstacle.size - 1));
    drawSprite(spriteDef, sourceX, 0, spriteDef.width * obstacle.size, spriteDef.height, obstacle.x, obstacle.y);
  };

  const loop = (now) => {
    if (destroyed) {
      return;
    }
    const dt = Math.max(0, Math.min(64, now - lastTime));
    lastTime = now;
    update(dt);
    render();
    raf = requestAnimationFrame(loop);
  };

  const makeObstacle = (score) => {
    const canFly = score > 160 && Math.random() < Math.min(0.33, (score - 160) / 900);
    if (canFly) {
      const yOptions = [50, 75, 100];
      return {
        type: 'pterodactyl',
        x: DESIGN.width + 20,
        y: yOptions[Math.floor(Math.random() * yOptions.length)],
        width: SPRITES.pterodactyl.width,
        height: SPRITES.pterodactyl.height,
        size: 1,
        speedOffset: Math.random() > 0.5 ? 0.8 : -0.8,
        anim: 0
      };
    }
    const large = Math.random() < Math.min(0.48, score / 500);
    const spriteDef = large ? SPRITES.largeCactus : SPRITES.smallCactus;
    const maxSize = large ? 2 : 3;
    const size = Math.floor(random(1, maxSize + 1));
    return {
      type: large ? 'largeCactus' : 'smallCactus',
      x: DESIGN.width + 20,
      y: large ? 90 : 105,
      width: spriteDef.width * size,
      height: spriteDef.height,
      size,
      speedOffset: 0,
      anim: 0
    };
  };

  const makeClouds = () => [
    {x: random(240, 360), y: random(24, 54)},
    {x: random(500, 680), y: random(18, 48)}
  ];

  const observer = new ResizeObserver(resize);
  observer.observe(shell);
  shell.addEventListener('keydown', onKeyDown);
  shell.addEventListener('keyup', onKeyUp);
  shell.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  sprite.addEventListener('load', render, {once: true});

  resetRun();
  raf = requestAnimationFrame(loop);

  return {
    update() {},
    getState() {
      return {...state};
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      shell.removeEventListener('keydown', onKeyDown);
      shell.removeEventListener('keyup', onKeyUp);
      shell.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      ctx.domRoot.innerHTML = '';
    }
  };
}

function makeGame(highScore) {
  return {
    started: true,
    crashed: false,
    score: 0,
    highScore,
    distance: 0,
    speed: 6,
    time: 0,
    blink: 0,
    groundOffset: 0,
    nextGap: 80,
    clouds: [],
    obstacles: [],
    player: {
      x: 50,
      y: 93,
      groundY: 93,
      vy: 0,
      ducking: false,
      jumping: false
    }
  };
}

function collides(player, obstacle) {
  const playerBoxes = player.ducking ? BOXES.ducking : BOXES.running;
  const obstacleBoxes = getObstacleBoxes(obstacle);
  return playerBoxes.some((pBox) => {
    const ax = player.x + pBox.x;
    const ay = player.y + pBox.y;
    return obstacleBoxes.some((oBox) => {
      const bx = obstacle.x + oBox.x;
      const by = obstacle.y + oBox.y;
      return ax < bx + oBox.width &&
        ax + pBox.width > bx &&
        ay < by + oBox.height &&
        ay + pBox.height > by;
    });
  });
}

function getObstacleBoxes(obstacle) {
  if (obstacle.type === 'pterodactyl') {
    return BOXES.pterodactyl;
  }
  const base = obstacle.type === 'largeCactus' ? BOXES.largeCactus : BOXES.smallCactus;
  if (obstacle.size <= 1) {
    return base;
  }
  const boxes = base.map((box) => ({...box}));
  boxes[1].width = obstacle.width - boxes[0].width - boxes[2].width;
  boxes[2].x = obstacle.width - boxes[2].width;
  return boxes;
}
