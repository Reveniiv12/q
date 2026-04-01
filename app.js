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
        const dashTimeMatch = block.match(/—\s*(\d{1,2}:?\d{1,2}(?:\s*[AP]M|ص|م)?)/i);

        if (dateMatch) {
            lastDate = dateMatch[1];
        } else if (dashTimeMatch && lastDate === 'غير معروف') {
            // If we see "— [Time]" but no date yet, default to today
            const today = new Date();
            lastDate = `${today.getDate()}/${today.getMonth() + 1}/${today.getFullYear()}`;
        }

        // Field Extraction - Flexible for single digit minutes (1:6) and optional colons
        // Increased flexibility for name - capture value after the "اسم العمليات" label
        const nameMatch = block.match(/(?:العمليات|اسم العمليات)\s*[:：]?\s*(.+?)(?:\n|$)/i);
        // Improved regex: allow dots, ignore leading non-digit characters like "—"
        const timeRegex = /((?:(?:\d{1,2}[:.]\d{1,2})|\d{3,4})(?:\s*[AP]M|ص|م)?)/i;
        const receiptMatch = block.match(new RegExp(`(?:وقت الاستلام|الاستلام)\\s*[:：]?\\s*[^0-9\\s]*\\s*${timeRegex.source}`, 'i'));
        const deliveryMatch = block.match(new RegExp(`(?:وقت التسليم|التسليم)\\s*[:：]?\\s*[^0-9\\s]*\\s*${timeRegex.source}`, 'i'));

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

    // Identify abandoned shifts (Transition points) with smart cross-referencing
    for (let i = 0; i < results.length; i++) {
        const res = results[i];
        if (res.status === 'قيد العمل') {
            // Check if there is a 'Completed' counterpart anywhere in the results
            const hasCompletedCounterpart = results.some(r =>
                r.status === 'مكتمل' &&
                r.name === res.name &&
                r.date === res.date &&
                r.receipt === res.receipt
            );

            if (hasCompletedCounterpart) {
                res.status = 'تحديث ';
            } else if (i < results.length - 1 && results[i + 1].name !== res.name) {
                // Only mark as failed if there was no completion and the next name is different
                res.status = 'لم يسلم العمليات';
            }
        }
    }

    renderResults(results);
}

function calculateSmartDuration(startTimeStr, endTimeStr) {
    const parseTimeToMinutes = (timeStr) => {
        if (!timeStr) return { mins: 0, hasAMPM: false };
        
        // Normalize: replace dot with colon for parsing
        const normalizedTime = timeStr.replace(/\./g, ':');
        let h = 0, m = 0, ampm = null;

        // Try standard format H:M [AM/PM]
        const colonMatch = normalizedTime.match(/(\d{1,2}):(\d{1,2})\s*([AP]M|ص|م)?/i);
        if (colonMatch) {
            h = parseInt(colonMatch[1]);
            m = parseInt(colonMatch[2]);
            ampm = colonMatch[3] ? colonMatch[3].toUpperCase() : null;
        } else {
            // Try HHMM format (like 808 or 1230)
            const digitsMatch = normalizedTime.match(/(\d{3,4})\s*([AP]M|ص|م)?/i);
            if (digitsMatch) {
                const digits = digitsMatch[1];
                if (digits.length === 3) {
                    h = parseInt(digits[0]);
                    m = parseInt(digits.substring(1));
                } else {
                    h = parseInt(digits.substring(0, 2));
                    m = parseInt(digits.substring(2));
                }
                ampm = digitsMatch[2] ? digitsMatch[2].toUpperCase() : null;
            }
        }

        if (ampm) {
            if ((ampm === 'PM' || ampm === 'م') && h < 12) h += 12;
            if ((ampm === 'AM' || ampm === 'ص') && h === 12) h = 0;
        }
        return { mins: h * 60 + m, hasAMPM: !!ampm };
    };

    const start = parseTimeToMinutes(startTimeStr);
    const end = parseTimeToMinutes(endTimeStr);

    let diff = end.mins - start.mins;

    // Handle cross-day shifts
    if (diff < 0) diff += 1440;

    // Smart Correction for missing AM/PM logic:
    // If one has AM/PM and the other doesn't, we should pick the AM/PM for the second one 
    // that makes the duration "reasonable" (usually the smallest positive duration).
    if (start.hasAMPM !== end.hasAMPM) {
        // Try adding 12 hours (720 mins) if the gap is too large
        if (diff > 720) {
            // If the duration is > 12h, maybe it should have been shorter 
            // (e.g., 5:30 PM to 8:08 PM [2:38] instead of 8:08 AM [14:38])
            diff -= 720;
        } else if (diff < 120 && diff > 0) {
            // If it's already a very short duration, it's likely correct.
        }
    } else if (!start.hasAMPM && !end.hasAMPM) {
        // Neither has AM/PM, use original logic for >12h wrap
        if (diff > 720) diff -= 720;
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
        if (res.status.includes('تحديث')) statusClass = 'badge-info'; // Blue for intermediate updates
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
