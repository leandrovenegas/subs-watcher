module.exports = {
  apps: [
    {
      name: 'subs-watcher',
      script: './watcher.js',
      cwd: __dirname,
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      env: {
        NODE_ENV: 'production'
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/watcher-error.log',
      out_file: './logs/watcher-out.log',
      merge_logs: true
    },
    {
      name: 'subs-web',
      script: './web/server.js',
      cwd: __dirname,
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      env: {
        NODE_ENV: 'production'
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/web-error.log',
      out_file: './logs/web-out.log',
      merge_logs: true
    }
  ]
};
