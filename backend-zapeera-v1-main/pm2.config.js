module.exports = {
  apps: [{
    name: 'zapeera-backend',
    script: 'npm',
    args: 'run dev',
    cwd: '/Users/oracle/Desktop/zapeera/v1/backend-zapeera-v1',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'development',
      USE_POSTGRESQL: 'true'
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true
  }]
};

