const importData = "JoelGrundydi@outlook.com----MOoyopg947------------------------------------------------------------9e5f94bc-e8a4-4e73-b8be-63364c29d753----M.C540_SN1.0.U.-CpFZTmNMcEFoMb9b5uf1XB7Rr8PiYdBuc0Z6c7j7PST8TJxucddMSmejWWuNGpjaEn3tQWcZlQFpuKZl9wzujmlbibUC1XlRT9AtvzmhrZUsoDoOBCB1ZlQfFHVJTXjHFI28Yeivf6D5oFJxMBKfawoZhHrorbz62I2Cn3a85MCDam2JW!H66fc6CQQy4iwjcTxZcda3G6sJEhxvobkYKBxLUEu70E1n7uoDqJrD87Pfmph5TxA0kZzMvuddyrTxe8F3hP498wEkIh9YJ0yLJOwX9b6gceiYxVd0SBshHEisQYkpasxkyj6iS9EHT8gEAla89ojff7o3KrWgPjKZiS!lnOjQI4BnvORENu7scNxNFOwr11nd8iQvrAqUwZLqgA$$";

console.log('原始数据长度:', importData.length);
console.log('原始数据:', importData);

// 手动解析，因为格式特殊
const email = importData.split('----')[0];
console.log('邮箱:', email);

// 查找client_id位置
const clientIdPattern = /----(\d{8}-[\w-]{4}-[\w-]{4}-[\w-]{4}-[\w-]{12})----/;
const match = importData.match(clientIdPattern);

if (match) {
    const client_id = match[1];
    console.log('Client ID:', client_id);

    // 提取refresh token (client_id之后的部分)
    const afterClientId = importData.split(client_id + '----')[1];
    const refresh_token_enc = afterClientId;

    console.log('Refresh Token:', refresh_token_enc.substring(0, 100) + '...');
    console.log('Refresh Token长度:', refresh_token_enc.length);

    // 构建导入数据
    const importObject = {
        email: email.trim(),
        client_id: client_id.trim(),
        refresh_token_enc: refresh_token_enc.trim(),
        status: 'authorized'
    };

    console.log('\n构建的导入对象:');
    console.log(JSON.stringify(importObject, null, 2));

} else {
    console.log('❌ 无法找到Client ID模式');
}