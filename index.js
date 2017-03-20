#!/usr/bin/env node

const request = require('request');

let config = require('yargs')
    .usage('$0 <options>')
    .option('u', {
        alias: 'nextcloud-url',
        describe: 'Nextcloud URL',
        demandOption: true
    })
    .option('h', {
        alias: 'hardening-warning',
        describe: 'Number of missing Hardenings that generate Warning',
        default: 2
    })
    .option('c', {
        alias: 'hardening-critical',
        describe: 'Number of missing Hardenings that generate Critical',
        default: 4
    })
    .option('l', {
        alias: 'disable-latestversion-warning',
        boolean: true,
        describe: 'Don\'t generate Warning if not latest Version'
    })
    .option('r', {
        alias: 'requeue-minutes',
        default: 180,
        describe: 'Requeue Scan if older than given minutes'
    })
    .help()
    .version()
    .argv;

const rating = [
    'F',
    'E',
    'D',
    'C',
    'A',
    'A+'
];

function getUUID(url, cb) {
    request({
        method: 'POST',
        url: 'https://scan.nextcloud.com/api/queue',
        qs: {
            url: url
        },
        headers: {
            'Content-type': 'application/x-www-form-urlencoded',
            'X-CSRF': 'true'
        },
        json: true
    }, function (err, res, body) {
        if (!err && body && body.uuid) {
            cb(null, body.uuid)
        } else {
            cb(err);
        }
    });
}

function requeue(url, cb) {
    request({
        method: 'POST',
        url: 'https://scan.nextcloud.com/api/requeue',
        qs: {
            url: url
        },
        headers: {
            'Content-type': 'application/x-www-form-urlencoded',
            'X-CSRF': 'true'
        }
    }, cb);
}

function getResult(uuid, cb) {
    request({
        method: 'GET',
        url: 'https://scan.nextcloud.com/api/result/' + uuid,
        json: true
    }, function (err, res, body) {
        cb(err, body);
    });
}

function outputResult(result, uuid, requeued) {
    let date = result.scannedAt.date.replace(/\.[0-9]{6}$/, '');
    let lastScan = new Date(date);
    lastScan = new Date(lastScan.getTime() - (lastScan.getTimezoneOffset() * 1000 * 60));
    date = new Date(lastScan.getTime());

    let dateString = date.getFullYear() + '-' +
        ('0' + (date.getMonth() + 1)).slice(-2) + '-' +
        ('0' + date.getDate()).slice(-2) + ' ' +
        ('0' + date.getHours()).slice(-2) + ':' +
        ('0' + date.getMinutes()).slice(-2) + ':' +
        ('0' + date.getSeconds()).slice(-2);

    let elapsedMinutes = (new Date() - lastScan) / 1000 / 60;
    if (!requeued && elapsedMinutes > config.requeueMinutes) {
        requeue(config.nextcloudUrl, () => outputResult(result, uuid, true));
        return;
    }

    let exitcode = 0;
    let text = 'Rating: ' + rating[result.rating];
    text = text + ', Vulnerabilities: ' + result.vulnerabilities.length;
    text = text + ', Version: ' + result.version;
    text = text + ', LatestVersionInBranch: ' + result.latestVersionInBranch;

    let keys = Object.keys(result.hardenings);
    let hardeningSum = keys.length;
    let hardeningCount = 0;
    keys.forEach(key => result.hardenings[key] ? hardeningCount++ : null);
    let hardeningMissing = hardeningSum - hardeningCount;

    text = text + ', Hardenings: ' + hardeningCount + '/' + hardeningSum;
    text = text + ', ScannedAt: ' + dateString;
    text = text + ', Result Summary: https://scan.nextcloud.com/results/' + uuid;

    if (
        // CRITICAL CONDITIONS
        (result.rating < 2) ||
        (result.vulnerabilities > 0) ||
        (hardeningMissing >= config.hardeningCritical)
    ) {
        exitcode = 2;
    } else if (
        // WARNING CONDITIONS
        (result[rating] < 4) ||
        (hardeningMissing >= config.hardeningWarning) ||
        (!result.latestVersionInBranch && !config.disableLatestversionWarning)
    ) {
        exitcode = 1;
    }

    switch (exitcode) {
        case 0:
            console.log('SCAN OK -', text);
            break;
        case 1:
            console.log('SCAN WARNING -', text);
            break;
        case 2:
            console.log('SCAN CRITICAL -', text);
            break;
    }
    process.exit(exitcode);
}

getUUID(config.nextcloudUrl, function (err, uuid) {
    if (!err) {
        getResult(uuid, function (err, result) {
            if (!err) {
                outputResult(result, uuid);
            } else {
                console.log('UNKNOWN: ', err);
                process.exit(3);
            }
        });
    } else {
        console.log('UNKNOWN: ', err);
        process.exit(3);
    }
});
