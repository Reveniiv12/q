document.getElementById('processBtn').addEventListener('click', processData);

function processData() {
    const input = document.getElementById('logInput').value;
    if (!input) return alert('يرجى لصق النص أولاً');

    // Split blocks based on Discord message separators (Role icon)
    const blocks = input.split(/(?=\S*Role icon,.*?\s—\s)/).filter(b => b.trim().length > 20);
    const results = [];
    let lastDate = 'غير معروف';

    blocks.forEach(block => {
        if (!block.trim()) return;

        // Date Extraction & Inheritance
        const dateMatch = block.match(/—\s*(\d{1,2}\/\d{1,2}\/\d{4})/);
        if (dateMatch) {
            lastDate = dateMatch[1];
        }

        // Field Extraction - Flexible for single digit minutes (1:6) and optional colons
        const nameMatch = block.match(/(?:العمليات|اسم العمليات)\s*[:：]?\s*(.+?)(?:\n|$)/i);
        const receiptMatch = block.match(/(?:وقت الاستلام|الاستلام)\s*[:：]?\s*(\d{1,2}:\d{1,2}(?:\s*[AP]M|ص|م)?)/i);
        const deliveryMatch = block.match(/(?:وقت التسليم|التسليم)\s*[:：]?\s*(\d{1,2}:\d{1,2}(?:\s*[AP]M|ص|م)?)/i);

        if (nameMatch || receiptMatch) {
            const name = nameMatch ? nameMatch[1].trim() : "غير معروف";
            // Extract just the time part for calculation
            const receiptStr = receiptMatch ? receiptMatch[1].trim() : null;
            const deliveryStr = deliveryMatch ? deliveryMatch[1].trim() : null;

            let duration = 0;
            let status = 'قيد العمل';
            let timestamp = 0;

            // Generate sortable timestamp
            if (lastDate !== 'غير معروف' && receiptStr) {
                const cleanTime = receiptStr.replace(/[صم]/g, (match) => match === 'ص' ? 'AM' : 'PM');
                // Ensure minutes have leading zero for the Date constructor if needed
                const standardizedTime = cleanTime.replace(/:(\d)(?!\d)/, ':0$1');
                timestamp = new Date(`${lastDate} ${standardizedTime}`).getTime();
            }

            if (receiptStr && deliveryStr) {
                duration = calculateSmartDuration(receiptStr, deliveryStr);
                status = 'مكتمل';
            }

            results.push({
                date: lastDate,
                name: name,
                receipt: receiptStr || '-',
                delivery: deliveryStr || '-',
                duration: duration,
                durationText: status === 'مكتمل' ? formatDuration(duration) : '-',
                overLimitText: (status === 'مكتمل' && duration > 180) ? formatDuration(duration - 180) : '-',
                status: status,
                timestamp: timestamp || Date.now()
            });
        }
    });

    // Sort results by date (Oldest to Newest)
    results.sort((a, b) => a.timestamp - b.timestamp);

    // Identify abandoned shifts (Transition points)
    for (let i = 0; i < results.length - 1; i++) {
        if (results[i].status === 'قيد العمل' && results[i + 1].name !== results[i].name) {
            results[i].status = 'لم يسلم العمليات';
        }
    }

    renderResults(results);
}

function calculateSmartDuration(startTimeStr, endTimeStr) {
    const parseTimeToMinutes = (timeStr) => {
        if (!timeStr) return 0;
        
        // Match hours, minutes and optional AM/PM/ص/م
        const match = timeStr.match(/(\d{1,2}):(\d{1,2})\s*([AP]M|ص|م)?/i);
        if (!match) return 0;

        let h = parseInt(match[1]);
        let m = parseInt(match[2]);
        let ampm = match[3] ? match[3].toUpperCase() : null;

        if (ampm) {
            if ((ampm === 'PM' || ampm === 'م') && h < 12) h += 12;
            if ((ampm === 'AM' || ampm === 'ص') && h === 12) h = 0;
        }
        return h * 60 + m;
    };

    const startMinutes = parseTimeToMinutes(startTimeStr);
    const endMinutes = parseTimeToMinutes(endTimeStr);

    let diff = endMinutes - startMinutes;

    // Handle cross-day shifts
    if (diff < 0) diff += 1440;

    // Smart Correction: If duration is > 12h and NO AM/PM was explicitly provided,
    // it's likely a 12-hour wrap error.
    const hasAMPM = /[AP]M|ص|م/i.test(startTimeStr) || /[AP]M|ص|م/i.test(endTimeStr);
    if (diff > 720 && !hasAMPM) {
        diff -= 720;
    }

    return diff;
}

function formatDuration(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    
    let text = '';
    if (h > 0) text += `${h} ساعة `;
    if (m > 0) text += `${m} دقيقة`;
    return text || '0 دقيقة';
}

function renderResults(results) {
    const tbody = document.getElementById('resultsBody');
    tbody.innerHTML = '';

    let totalMinutes = 0;
    let overLimitCount = 0;
    let completedCount = 0;
    let missedDeliveryCount = 0;
    let totalOverLimitMinutes = 0;
    let subHourCount = 0;
    let subHourMinutes = 0;

    results.forEach(res => {
        const tr = document.createElement('tr');
        
        let statusClass = 'badge-warning';
        if (res.status === 'مكتمل') statusClass = 'badge-success';
        if (res.status === 'لم يسلم العمليات') {
            statusClass = 'badge-danger';
            missedDeliveryCount++;
        }

        let overLimitStyle = '';
        if (res.overLimitText !== '-') {
            overLimitStyle = 'color: #ef4444; font-weight: 700;';
        } else if (res.duration < 60 && res.status === 'مكتمل') {
             overLimitStyle = 'color: #fb923c; font-weight: 700;'; // Orange for minor violations
        }
        
        tr.innerHTML = `
            <td>${res.date}</td>
            <td>${res.name}</td>
            <td>${res.receipt}</td>
            <td>${res.delivery}</td>
            <td>${res.durationText}</td>
            <td style="${overLimitStyle}">${res.overLimitText}</td>
            <td><span class="badge ${statusClass}">${res.status}</span></td>
        `;
        tbody.appendChild(tr);

        if (res.status === 'مكتمل') {
            completedCount++;
            
            if (res.duration < 60) {
                // Violation: Less than 1 hour
                subHourCount++;
                subHourMinutes += res.duration;
            } else if (res.duration >= 60 && res.duration <= 180) {
                // Normal
                totalMinutes += res.duration;
            } else if (res.duration > 180) {
                // Over-limit: Exceeded 3 hours
                totalMinutes += 180;
                overLimitCount++;
                totalOverLimitMinutes += (res.duration - 180);
            }
        }
    });

    // Update Stats
    document.getElementById('statsSection').style.display = 'grid';
    document.getElementById('resultsSection').style.display = 'block';

    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    document.getElementById('totalHours').innerText = `${h}س ${m}د`;
    document.getElementById('entriesCount').innerText = results.length;
    document.getElementById('completedCount').innerText = completedCount;
    document.getElementById('missedDeliveryCount').innerText = missedDeliveryCount;
    document.getElementById('overLimitCount').innerText = overLimitCount;
    
    // Update Over-Limit Time Stat
    const oH = Math.floor(totalOverLimitMinutes / 60);
    const oM = totalOverLimitMinutes % 60;
    document.getElementById('totalOverLimitTime').innerText = `${oH}س ${oM}د`;

    // Update Sub-Hour Violations Stat
    const sH = Math.floor(subHourMinutes / 60);
    const sM = subHourMinutes % 60;
    document.getElementById('subHourCount').innerText = subHourCount;
    document.getElementById('subHourTotalTime').innerText = `${sH}س ${sM}د`;
}
