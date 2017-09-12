var express = require("express");
var request = require("request");
var app = express();
var https = require("https");
var fs = require("fs");
var child_process = require("child_process");
var formidable = require("formidable");
var domain = require("domain");
var log4js = require("log4js");
var log4js_config = require("./log4js.json");
log4js.configure(log4js_config);
var logger = log4js.getLogger("log");
const path = require("path");

const port = 443;
const tlApiKey = "107adc2db7f34eaaa3a552fe359b2d6a";
const tlApiUrl = "http://www.tuling123.com/openapi/api";
const baiduApiKey = "ka0XBT54ZgyX6OrBKbR09228";
const baiduSecretKey = "1e2119959703c66afcadc2ff1f9b4dc0";
const baiduSpeechRecognitionUrl = "http://vop.baidu.com/server_api";
const baiduSpeechCompositionUrl = "http://tsn.baidu.com/text2audio";

const wxAppid = "wxb7e08f7645ad8b47";
const wxSecretKey = "002e032255dcf88957f802f443adc8d7";

const fileTmp = "/home/homolo/tmp/";
var accessToken = "";

const errAnswer = "小Q没听清呢[委屈]";
const overTimesAnswer = "明天再来找我吧，小Q太累了[睡觉]";

app.use(function (req, res, next) {
    var reqDomain = domain.create();
    reqDomain.on("error", function (err) {
        logger.error("catch error:" + err.stack);
        res.send(500, err.stack);
    });
    reqDomain.run(next);
});

app.use(express.static(path.join(__dirname, "public")));
request.get("https://openapi.baidu.com/oauth/2.0/token?grant_type=client_credentials&client_id=" + baiduApiKey + "&client_secret=" + baiduSecretKey, function (req, res) {
    accessToken = JSON.parse(res.body).access_token;
    logger.info("accessToken : " + accessToken);
});

var postRequest = function (requestUrl, json, callback) {
    request({
        method: "POST",
        url: requestUrl,
        json: true,
        headers: {
            "Content-Type": "application/json;charset:utf-8"
        },
        body: json
    }, callback);
};

app.get("/wx/getOpenid/:code", function (req, res) {
    var code = req.params.code;
    request.get("https://api.weixin.qq.com/sns/jscode2session?grant_type=authorization_code&appid=" + wxAppid + "&secret=" + wxSecretKey + "&js_code=" + code, function (req1, res1) {
        var openid = JSON.parse(res1.body).openid;
        res.end(openid);
    });
});

app.post("/wx/robot", function (req, res) {
    var postString = "";
    req.on("data", function (chunk) {
        postString += chunk;
    });
    req.on("end", function () {
        var postObj = JSON.parse(postString);
        postObj.key = tlApiKey;
        logger.info(postObj.username + ": " + postObj.info);
        postRequest(tlApiUrl, postObj, function (error, response, body) {
            if (!error && response.statusCode == 200) {
                if (body.code == 40004) {
                    body.text = overTimesAnswer;
                }
                logger.info("小Q: " + body.text);
                res.end(JSON.stringify(body));
            }
        });
    });
});

app.post("/wx/uploadSilk", function (req, res) {
    var form = new formidable.IncomingForm();
    form.encoding = "utf-8";
    form.uploadDir = fileTmp;
    form.keepExtensions = true;
    form.maxFieldsSize = 10 * 1024 * 1024;
    form.parse(req, function (err, fields, files) {
        if (err) {
            res.send(err);
            return;
        }
        var userid = fields.userid;
        if (!userid) {
            res.end(JSON.stringify({code: 102, text: "你要同意我获取你的信息啊[乖]"}));
            return;
        }
        var username = fields.username;
        var extName = /\.[^\.]+/.exec(files.file.name);
        var ext = Array.isArray(extName) ? extName[0] : "";
        var newPath = fileTmp + userid + ext;
        fs.renameSync(files.file.path, newPath);
        child_process.exec("./bin/silk-to-wav " + userid, function (err, stdout, stderr) {
            if (err) {
                logger.error("exec shell fail" + stderr);
                res.end(JSON.stringify({code: 102, text: errAnswer}));
                return;
            }
            var base64Data = new Buffer(fs.readFileSync(fileTmp + userid + ".wav")).toString("base64");
            var data = {
                "format": "wav",
                "rate": 16000,
                "channel": "1",
                "token": accessToken,
                "cuid": "zhukai",
                "len": fs.statSync(fileTmp + userid + ".wav").size,
                "speech": base64Data
            };
            child_process.exec("rm -rf " + fileTmp + userid + ".wav");
            postRequest(baiduSpeechRecognitionUrl, data, function (error, response, body) {
                if (body.err_no == 3301) {
                    res.end(JSON.stringify({code: 102, text: errAnswer}));
                } else if (body.err_no == 0) {
                    if (body.result[0] == "，") {
                        res.end(JSON.stringify({code: 102, text: errAnswer}));
                    } else {
                        var postObj = {
                            key: tlApiKey,
                            info: body.result[0],
                            userid: userid
                        };
                        logger.info(username + "（语音）: " + body.result[0]);
                        postRequest(tlApiUrl, postObj, function (error, response, body) {
                            if (!error && response.statusCode == 200) {
                                if (body.code == 40004) {
                                    body.text = overTimesAnswer;
                                } else if (body.text.length > 341) {
                                    logger.info("小Q: " + body.text);
                                    res.end(JSON.stringify({code: 102, text: body.text}));
                                }
                                const fileName = userid + Date.now() + ".mp3";
                                var writeStream = fs.createWriteStream("public/static/" + fileName);
                                request(baiduSpeechCompositionUrl + "?lan=zh&ctp=1&tex=" + encodeURIComponent(encodeURIComponent(body.text)) + "&cuid=" + userid + "&per=4&tok=" + accessToken).pipe(writeStream);
                                writeStream.on("close", function () {
                                    logger.info("小Q（语音）: " + body.text);
                                    res.end(JSON.stringify({code: 101, text: fileName}));
                                });
                            }
                        });
                    }
                }
            });
        });
    });
});

process.on("uncaughtException", function (err) {
    logger.error(err);
});

var options = {
    key: fs.readFileSync("./homolo.key"),
    cert: fs.readFileSync("./homolo.pem")
};

https.createServer(options, app).listen(port, function () {
    logger.info("start https server on " + port);
});
