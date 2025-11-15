升级一些功能，包括之前有朋友提到的上传页可以设置不显示历史图片。

还有其他一些功能，并简化了安装流程。功能更强大，安装更简单。安装方法在最下方。

![QulTZJAN9YXOmUysZlnxXNU3haEDmsOa.webp](https://cdn.nodeimage.com/i/QulTZJAN9YXOmUysZlnxXNU3haEDmsOa.webp)

![hCED2vi8zJwOpprbLtDebFeYAtm46SRP.webp](https://cdn.nodeimage.com/i/hCED2vi8zJwOpprbLtDebFeYAtm46SRP.webp)

![SkoxoIKBEM7ZT3MZHj59cyJ8CtkVeHjJ.webp](https://cdn.nodeimage.com/i/SkoxoIKBEM7ZT3MZHj59cyJ8CtkVeHjJ.webp)

![dXGt1nfp22zqkaxJltVjkg66ECtJ5DfR.webp](https://cdn.nodeimage.com/i/dXGt1nfp22zqkaxJltVjkg66ECtJ5DfR.webp)

![Sh1cADpBZmWjr3VYkTUZi0LJMiYeIbHO.webp](https://cdn.nodeimage.com/i/Sh1cADpBZmWjr3VYkTUZi0LJMiYeIbHO.webp)

![av8xkEwDy536QyPoVOVflmCDzRWxXxT7.webp](https://cdn.nodeimage.com/i/av8xkEwDy536QyPoVOVflmCDzRWxXxT7.webp)

![PcfitHV0lAApeuZvIyZFpOlraI1lLYUI.webp](https://cdn.nodeimage.com/i/PcfitHV0lAApeuZvIyZFpOlraI1lLYUI.webp)

2.0版安装方案：
服务器需要有安装安装 Docker 和 Docker Compose

```
git clone https://github.com/1keji/modern-images.git /var/www/modern-images
```

```
cd /var/www/modern-images
```

```
cp .env.example .env
```

修改 .env 文件中的敏感信息（必须！） 至少修改以下配置:

- SESSION_SECRET (改为随机字符串)
- DB_PASSWORD (改为强密码)
- REDIS_PASSWORD (改为强密码)

启动所有服务 
```
docker-compose up -d
```
反代端口就OK了，默认是3000.你也可以自行设置其他端口。

github地址：
https://github.com/1keji/modern-images


