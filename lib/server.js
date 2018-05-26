const net = require('net');
const throught2 = require('through2');
const SecureSocket = require('./core/secure-socket');
const Cipher = require('./core/cipher');
const log4js = require('log4js');


class LSServer extends SecureSocket {  //SecureSocket为父类
    constructor(password, listenAddr = {
        host: '0.0.0.0',
        port: 7488
    }) {
        super(Cipher.createCipher(password));
        this.listenAddr = listenAddr;
        this.logger = log4js.getLogger('LsServer');
        this.logger.level = process.env.NODE_ENV === 'debug' ? 'debug' : 'info';
        LSServer.instance = this;
    }

    trimAddress(addr) {
        return addr.trim()
            .replace(/\u0000|\u0001|\u0002|\u0003|\u0004|\u0005|\u0006|\u0007|\u0008|\u0009|\u000a|\u000b|\u000c|\u000d|\u000e|\u000f|\u0010|\u0011|\u0012|\u0013|\u0014|\u0015|\u0016|\u0017|\u0018|\u0019|\u001a|\u001b|\u001c|\u001d|\u001e|\u001f/g, "");
    }

    handleConnection(localConnection) {       //客户端TCP-处理函数
        let _this = LSServer.instance;
        localConnection.on('error', (err) => {
            _this.logger.error(`远程到代理服务器的连接发生错误，错误信息：${err.message}`);
            localConnection.destroy();
        });
        _this.logger.info(`接受连接：${localConnection.remoteAddress}:${localConnection.remotePort}`);
        _this.socketRead(localConnection)   //读取客户端TCP信息
            .then((chunk) => {   //与浏览器Socks握手
                let buf = [...chunk];
                if (!buf && buf[0] !== 0x05) {  //data[0]
                    localConnection.destroy();
                    return;
                }
                _this.socketWrite(localConnection, Buffer.from([0x05, 0x00]))
                    .then((err) => {
                        if(err){
                            _this.logger.error(`写入数据失败,失败信息:${err.message}`);
                            localConnection.destroy();
                        }
                        _this.socketRead(localConnection)
                            .then((chunk) => {
                                buf = [...chunk];
                                if (buf.length < 7) {
                                    localConnection.destroy();
                                    return;
                                }
                                if (buf[1] !== 0x01) {
                                    localConnection.destroy();
                                    // 目前只支持 CONNECT
                                    return;
                                }
                                let remote = _this.trimAddress(Buffer.from(buf.slice(4, buf.length - 2)).toString());
                                let port = parseInt("0x" + Buffer.from(buf.slice(buf.length - 2)).toString('hex'));
                                _this.logger.info(`连接到 ${remote}:${port}`);
                                let remoteConnection = net.createConnection(port, remote, function () {
                                    _this.socketWrite(localConnection, Buffer.from([0x05, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]))
                                        .then((err) => {
                                            if(err){
                                                _this.logger.error(`写入数据失败,失败信息:${err.message}`);
                                                localConnection.destroy();
                                            }
                                            remoteConnection.pipe(throught2(function (chunk, enc, callback) {
                                                chunk = _this.encodeBuffer(chunk);
                                                callback(null, chunk);
                                            })).pipe(localConnection);
                                            localConnection.pipe(throught2(function (chunk, enc, callback) {
                                                chunk = _this.decodeBuffer(chunk);
                                                callback(null, chunk);
                                            })).pipe(remoteConnection);
                                        });
                                });
                                remoteConnection.on('error', function (err) {
                                    _this.logger.error(`连接到远程服务器 ${remote}:${port} 失败,失败信息:${err.message}`);
                                    remoteConnection.destroy();
                                    localConnection.destroy();
                                    return;
                                })
                            });
                    });
            });
    }

    //todo: deal didListen
    listen(didListen) {
        let _this = this;
        let server = net.createServer(this.handleConnection);
        server.on('error', function (err) {
            _this.logger.error(`代理服务器发生错误，错误信息：${err.message}`);
            server.close();
        });
        server.listen(this.listenAddr.port, () => {
            _this.logger.info(`代理服务器启动，监听端口${_this.listenAddr.port}...`);
        })
    }

}

module.exports = LSServer;