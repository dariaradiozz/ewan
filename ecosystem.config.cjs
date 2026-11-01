module.exports = {
  apps: [
    {
      name: 'poketwo-bot',
      script: 'npm',
      args: 'start',
      cwd: __dirname,
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: '10s',
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
