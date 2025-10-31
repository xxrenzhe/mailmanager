#!/usr/bin/env node

const test_data = `test1@example.com----password1----client-id-1----token1
test2@example.com----password2----client-id-2----token2
test3@example.com----password3----client-id-3----token3`;

async function testBulkImport() {
    console.log('🧪 Testing bulk import optimization...');

    try {
        // Test 1: Parse data
        console.log('\n1. Testing data parsing...');
        const parseResponse = await fetch('http://localhost:3000/api/bulk-import/parse', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ import_data: test_data })
        });

        const parseResult = await parseResponse.json();
        console.log('Parse result:', parseResult);

        if (parseResult.success) {
            console.log(`✅ Parsed ${parseResult.count} emails successfully`);
        }

        // Test 2: Start bulk import
        console.log('\n2. Starting bulk import...');
        const importResponse = await fetch('http://localhost:3000/api/bulk-import/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ import_data: test_data })
        });

        const importResult = await importResponse.json();
        console.log('Import result:', importResult);

        if (importResult.success) {
            console.log(`✅ Bulk import started with ID: ${importResult.import_id}`);
            console.log(`📊 Estimated time: ${importResult.estimatedTime.minutes} minutes`);

            // Test 3: Monitor progress
            console.log('\n3. Monitoring progress...');
            await monitorProgress(importResult.import_id);
        }

        console.log('\n🎉 All tests completed successfully!');

    } catch (error) {
        console.error('❌ Test failed:', error.message);
    }
}

async function monitorProgress(importId) {
    let lastStatus = null;
    for (let i = 0; i < 10; i++) {
        await new Promise(resolve => setTimeout(resolve, 2000));

        try {
            const response = await fetch(`http://localhost:3000/api/bulk-import/status/${importId}`);
            const status = await response.json();

            if (status.error) {
                console.log('❌ Status error:', status.error);
                break;
            }

            const stats = status.stats;
            const progress = Math.round((stats.processed / stats.total) * 100);

            console.log(`📈 Progress: ${progress}% (${stats.processed}/${stats.total}) | ✅: ${stats.successful} | ❌: ${stats.failed} | ⏳: ${stats.pending}`);

            if (status.status === 'completed') {
                console.log('🎉 Import completed!');
                console.log(`   Duration: ${Math.round((new Date(status.endTime) - new Date(status.startTime)) / 1000)}s`);
                console.log(`   Success: ${stats.successful}, Failed: ${stats.failed}`);
                break;
            }

            if (JSON.stringify(status) === JSON.stringify(lastStatus)) {
                continue; // No change, skip detailed output
            }
            lastStatus = status;

        } catch (error) {
            console.log('⚠️  Progress check failed:', error.message);
        }
    }
}

// Run the test
testBulkImport();