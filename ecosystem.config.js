module.exports = {
  apps: [
    {
      name: 'image-hosting',
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',
      // Performance optimization: enable garbage collection
      node_args: '--expose-gc --max-old-space-size=2048',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: 3000
      },
      env_staging: {
        NODE_ENV: 'staging',
        PORT: 8080
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      // 日志配置
      log_file: './logs/app.log',
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      
      // 自动重启配置
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      
      // 进程管理
      kill_timeout: 3000,
      wait_ready: true,
      listen_timeout: 8000
    },
    
    // 开发环境配置（端口3001）
    {
      name: 'image-hosting-dev',
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',
      // Performance optimization: enable garbage collection
      node_args: '--expose-gc --max-old-space-size=1024',
      env: {
        NODE_ENV: 'development',
        PORT: 3001
      },
      watch: true,
      watch_delay: 1000,
      ignore_watch: [
        'node_modules',
        'uploads',
        'sessions',
        'logs',
        '*.db',
        '*.log'
      ],
      autorestart: true,
      max_memory_restart: '500M'
    },
    
    // 测试环境配置（端口8080）
    {
      name: 'image-hosting-test',
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',
      // Performance optimization: enable garbage collection
      node_args: '--expose-gc --max-old-space-size=1024',
      env: {
        NODE_ENV: 'test',
        PORT: 8080
      },
      autorestart: true,
      max_memory_restart: '500M'
    }
  ],

  deploy: {
    // 生产环境部署配置
    production: {
      user: 'node',
      host: 'your-server.com',
      ref: 'origin/main',
      repo: 'git@github.com:your-username/image-hosting.git',
      path: '/var/www/image-hosting',
      'pre-deploy-local': '',
      'post-deploy': 'npm install && pm2 reload ecosystem.config.js --env production',
      'pre-setup': ''
    },
    
    // 开发环境部署配置
    development: {
      user: 'dev',
      host: 'dev-server.com',
      ref: 'origin/develop',
      repo: 'git@github.com:your-username/image-hosting.git',
      path: '/var/www/image-hosting-dev',
      'post-deploy': 'npm install && pm2 reload ecosystem.config.js --env development'
    }
  }
}; 