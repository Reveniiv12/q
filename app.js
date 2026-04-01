document.getElementById('processBtn').addEventListener('click', processData);

function processData() {
    const input = document.getElementById('logInput').value;
    if (!input) return alert('يرجى لصق النص أولاً');

    const blocks = input.split(/(?=\S*Role icon,.*?\s—\s\d{1,2}\/\d{1,2}\/\d{4})/).filter(b => b.trim().length > 20);
    const results = [];

    blocks.forEach(block => {
        const dateMatch = block.match(/—\s*((\d{1,2})\/(\d{1,2})\/(\d{4})\s*(\d{1,2}):(\d{2})\s*(AM|PM))/);
        const headerAMPM = dateMatch ? dateMatch[7] : null;

        const nameMatch = block.match(/(اسم\s+)?العمليات[\s:]+(.*?)(\n|$)/i);
        const operationsName = nameMatch ? nameMatch[2].trim() : 'غير معروف';

        // More robust time regex: handles various separators like : or :: or spaces
        const timeRegex = /(\d{1,2}:\d{2})\s*(AM|PM|ص|م)?/i;

        // Using fuzzy matching for "الاستلام" and "التسليم" to handle typos like extra letters
        const receiptMatch = block.match(/وقت\s*الاستلا[ا]*م[\s:]+(\d{1,2}:\d{2})\s*(AM|PM|ص|م)?/i);
        const deliveryMatch = block.match(/وقت\s*التسلي[ي]*م[\s:]+(\d{1,2}:\d{2})\s*(AM|PM|ص|م)?/i);

        let duration = 0;
        let durationText = '-';
        let overLimitText = '-';
        let status = 'غير مكتمل';

        if (receiptMatch && deliveryMatch) {
            duration = calculateSmartDuration(receiptMatch, deliveryMatch, headerAMPM);
            durationText = formatDuration(duration);
            
            // Calculate over-limit (if duration > 180 minutes)
            if (duration > 180) {
                overLimitText = formatDuration(duration - 180);
            }
            
            status = 'مكتمل';
        } else if (receiptMatch) {
            status = 'قيد العمل';
        }

        results.push({
            timestamp: dateMatch ? new Date(`${dateMatch[4]}-${dateMatch[2]}-${dateMatch[3]} ${dateMatch[5]}:${dateMatch[6]} ${dateMatch[7]}`).getTime() : 0,
            date: dateMatch ? `${dateMatch[2]}/${dateMatch[3]}/${dateMatch[4]} ${dateMatch[5]}:${dateMatch[6]} ${dateMatch[7]}` : 'غير معروف',
            name: operationsName,
            receipt: receiptMatch ? `${receiptMatch[1]} ${receiptMatch[2] || ''}` : '-',
            delivery: deliveryMatch ? `${deliveryMatch[1]} ${deliveryMatch[2] || ''}` : '-',
            duration: duration,
            durationText: durationText,
            overLimitText: overLimitText,
            status: status
        });
    });

    // Sort results by date (Oldest to Newest)
    results.sort((a, b) => a.timestamp - b.timestamp);

    // [New Logic] Identify the EXACT point where a shift was abandoned
    for (let i = 0; i < results.length - 1; i++) {
        const current = results[i];
        const next = results[i + 1];

        if (current.status === 'قيد العمل') {
            // If the next logical update is by someone else, or the next record is a fresh receipt
            // we assume the current one was abandoned and never delivered.
            if (next.name !== current.name) {
                current.status = 'لم يسلم العمليات';
            }
        }
    }

    renderResults(results);
}

function calculateSmartDuration(startMatch, endMatch, headerAMPM) {
    const parseTimeToMinutes = (timeStr, ampm) => {
        let [h, m] = timeStr.split(':').map(Number);
        
        if (ampm) {
            ampm = ampm.toUpperCase();
            if ((ampm === 'PM' || ampm === 'م') && h < 12) h += 12;
            if ((ampm === 'AM' || ampm === 'ص') && h === 12) h = 0;
        } else {
            // Default 12h-system handling if no AM/PM
            if (h === 12) h = 0; 
        }
        return h * 60 + m;
    };

    const startMinutes = parseTimeToMinutes(startMatch[1], startMatch[2]);
    const endMinutes = parseTimeToMinutes(endMatch[1], endMatch[2]);

    let diff = endMinutes - startMinutes;

    // Handle cross-day shifts
    if (diff < 0) diff += 1440;

    // Smart Correction: If duration is > 12h and NO AM/PM was explicitly provided in the log line,
    // it's almost certainly a 12-hour wrap error (e.g. 11 to 1 thinking it's 11am to 1am).
    if (diff > 720 && !startMatch[2] && !endMatch[2]) {
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
