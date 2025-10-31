const https = require('https');

console.log('🧪 测试Microsoft Graph API直接调用...');

// 从你的curl命令中获取的有效access_token
const accessToken = 'EwAYBOl3BAAUxG8T4TQNdaMKj7W5hdXgD68HTzwAAY71p2km5ProIVhSHz2L2THIjPAMWP087HhpaYrtlYlxrTJvK/ekTUuP8vFwQmnaS3jOFZx8SmR5aeAh2RwpGgbCnHn4fefg6bRaKwnxQyXpHN+n68Y1JBK3mVyfR20gEtJ0yrnzj2qr+EYv7/M2TUrRf+VBO3u2DFbqNnOx1nU3zLfcWImRzk/sAB2LlJHaNIDMzdCbAec6mwz0NAnB700yNFiZIl+eUpJ/PspC6r2M7Ovl6B4DgAiWT90aB3QDykEkGMRN1scns8ZOyNTycRsC8WRPYFcVzyDc1TOxBYIVJcY+1z3px2lbtHhm2VFL7hsqawk4hL4oUfPxa++QCBkQZgAAEHwgm67qaLwSeZxlSLEyZrrgAnBnen2Qpd2wwQGQWwss0IPP50hcY+HFaIEXeLO4Mbnh1mEosW9vhr0Yi1XHgfkOWnlOxABnSs94GrLQA4xBGjqbmO6F4Y1VSFkm0+uDf88grL2Ab0Hxc2o4ZLSPYPhc8r4NXSlYFB5iSSIMXAEJ3HeJ8dN5A09MLZHUywmxyJfjI+GQONOHpKlvDIqBGoGVpHIPhOlStYfKtKM+2v/o3jtEpGhMcyd6utVQGDTkzR6UDgdgSa/EE9lax37J/eQe4HYt39FAep5cSihyJ9Vh1zQDoW2gXhkTR22C6xaja0DALU4+jZMe0927HxX4V7FJIQ97oRB2UAUaUuwdTHAyBShagVOm3lo23P3Rc9+zdiT9GQ+pXvfF1ENSRgzdM0BydHOyvX4VhsoTwmTgd2JaBz6M4jraZw0XpNgmyg0AcCyu2XxLfPOxeGCcnIiXWOmgrfd2MpXttz4wdWDdom3w8uXCou8POP0RDP3WL/NcC0SW+8kupZVE8N5aZTBTkjQyYddG0KRvnVi94q+dQRSQKE6AlOfK1qYjXOKDRYUHt+wCY/t5ROWHTpzl+56jRDmqRzQuF5rKbu22UcLAIGhJcldk2+Cr8Gw9MloMoi6hQz5QlVYhUwgF4KmYZLgtZE/bXTBtag0/XoLouW3d+GEsCv2drL/qHVCTCJhwCW7MMNMN01SUC0sh8iTV6rIKdbCq41FG4DYCQrF+sMNbH9K84SmLOAT20TnIspxAH5Y/QuYVhgaWhznqOLk+2+SY2wslXVk/3qrOP7/EqgtLdxCkOMyHTJvkA8bYQ8+EUWvz+UjamUdC9GW+P3+mZecd2uysclPET8hipcWfB5lDcbzsoAwiSoph9MyxdTACxU1y/3nx2gpcJYQAIhC6j7t5/cnWyOvA2M8wvT2SPIL7Su3pKIED2XurBKNzFasafwzEpO+S7mFPVB1X1TGN1wrvHjZUH+oP9q0vz5dlP+HfQYEgmNsUAw==';

function testMicrosoftGraphAPI() {
    const options = {
        hostname: 'graph.microsoft.com',
        port: 443,
        path: '/v1.0/me/messages?$top=10&$select=subject,from,receivedDateTime,body',
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        }
    };

    console.log('📧 正在调用Microsoft Graph API获取邮件...');

    const req = https.request(options, (res) => {
        console.log(`📊 状态码: ${res.statusCode}`);
        console.log(`📋 响应头: ${JSON.stringify(res.headers, null, 2)}`);

        let data = '';

        res.on('data', (chunk) => {
            data += chunk;
        });

        res.on('end', () => {
            try {
                const jsonData = JSON.parse(data);
                console.log('✅ API调用成功!');

                if (jsonData.value && jsonData.value.length > 0) {
                    console.log(`📬 找到 ${jsonData.value.length} 封邮件:`);

                    jsonData.value.forEach((email, index) => {
                        console.log(`\n📧 邮件 ${index + 1}:`);
                        console.log(`  主题: ${email.subject}`);
                        console.log(`  发件人: ${email.from?.emailAddress?.name} <${email.from?.emailAddress?.address}>`);
                        console.log(`  收件时间: ${email.receivedDateTime}`);

                        // 提取验证码
                        const codeMatch = email.subject?.match(/\b\d{4,8}\b/);
                        if (codeMatch) {
                            console.log(`  🔢 验证码: ${codeMatch[0]}`);
                        }
                    });
                } else {
                    console.log('📭 邮箱中没有邮件');
                }

            } catch (error) {
                console.error('❌ 解析响应失败:', error.message);
                console.log('原始响应:', data);
            }
        });
    });

    req.on('error', (error) => {
        console.error('❌ API请求失败:', error.message);
    });

    req.end();
}

// 执行测试
testMicrosoftGraphAPI();