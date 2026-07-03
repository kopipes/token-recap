document.addEventListener('DOMContentLoaded', () => {
    // Elements
    const periodSelect = document.getElementById('period');
    const startDateInput = document.getElementById('start-date');
    const endDateInput = document.getElementById('end-date');
    const tableBody = document.getElementById('table-body');
    const btnSync = document.getElementById('btn-sync');
    const btnExportCSV = document.getElementById('btn-export-csv');
    const btnExportXLS = document.getElementById('btn-export-xls');
    const sortTokensHeader = document.getElementById('sort-tokens');
    const sortIcon = document.getElementById('sort-icon');
    const definitionsGrid = document.getElementById('definitions-grid');
    const monthSelect = document.getElementById('month-select');
    const projectFilter = document.getElementById('project-filter');

    // Dinamis, diambil dari backend via pricing.json
    let exactPricing = {};
    
    // Custom Modal System
    const showModal = (title, message, isError = false) => {
        const modal = document.getElementById('custom-modal');
        const titleEl = document.getElementById('modal-title');
        const msgEl = document.getElementById('modal-message');
        const contentEl = modal.querySelector('.modal-content');
        
        if (!modal) return alert(message); // Failsafe
        
        titleEl.textContent = title;
        msgEl.innerHTML = message;
        
        if (isError) contentEl.classList.add('modal-error');
        else contentEl.classList.remove('modal-error');
        
        modal.style.display = 'flex';
    };

    const hideModal = () => {
        const modal = document.getElementById('custom-modal');
        if (modal) modal.style.display = 'none';
    };

    const btnModalClose = document.getElementById('modal-close');
    const btnModalOk = document.getElementById('modal-ok');
    if (btnModalClose) btnModalClose.addEventListener('click', hideModal);
    if (btnModalOk) btnModalOk.addEventListener('click', hideModal);

    const calculateCost = (modelName, inputTokens, outputTokens) => {
        let baseName = modelName.replace('models/', '').toLowerCase();
        
        let prices = exactPricing[baseName];
        
        // Failsafe fallback jika model sangat baru dan belum ada di kamus
        if (!prices) {
            if (baseName.includes('exp') || baseName.includes('preview') || baseName.includes('test')) prices = { input: 0, output: 0 };
            else if (baseName.includes('flash-lite') || baseName.includes('8b')) prices = { input: 0.0375, output: 0.15 }; 
            else if (baseName.includes('flash')) prices = { input: 0.075, output: 0.30 };
            else if (baseName.includes('pro-image') || baseName.includes('vision')) prices = { input: 1.25, output: 0 };
            else if (baseName.includes('pro')) prices = { input: 1.25, output: 5.00 };
            else prices = { input: 0, output: 0 };
        }

        const inputCost = (inputTokens / 1000000) * prices.input;
        const outputCost = (outputTokens / 1000000) * prices.output;
        return inputCost + outputCost;
    };

    // Populate month selector dynamically (last 12 months)
    if (monthSelect) {
        const tempDate = new Date();
        for (let i = 0; i < 12; i++) {
            const m = tempDate.getMonth();
            const y = tempDate.getFullYear();
            // Format to Indonesian month (e.g. "Maret 2026")
            const monthName = tempDate.toLocaleString('id-ID', { month: 'long', year: 'numeric' });
            
            const option = document.createElement('option');
            option.value = `${y}-${String(m + 1).padStart(2, '0')}`;
            option.textContent = monthName;
            monthSelect.appendChild(option);
            
            tempDate.setMonth(tempDate.getMonth() - 1);
        }

        // Auto-adjust dates when a month is selected
        monthSelect.addEventListener('change', (e) => {
            const [yStr, mStr] = e.target.value.split('-');
            const year = parseInt(yStr, 10);
            const month = parseInt(mStr, 10) - 1; // 0-indexed in JS date
            
            const firstDayStr = `${yStr}-${mStr}-01`;
            
            const lastDayDate = new Date(year, month + 1, 0); // Day 0 is last day of previous month
            const lastDayStr = `${yStr}-${mStr}-${String(lastDayDate.getDate()).padStart(2, '0')}`;
            
            startDateInput.value = firstDayStr;
            endDateInput.value = lastDayStr;
            
            fetchProjects();
            fetchData();
        });
    }

    // Database Kamus Model Google
    const modelDictionary = {
        'gemini-1.5-pro': 'Model canggih untuk tugas penalaran tingkat tinggi, analisis dokumen kompleks, dan memiliki konteks token sangat besar.',
        'gemini-1.5-flash': 'Model berkecepatan tinggi dan serbaguna, optimal untuk skala besar dengan biaya efisien untuk sebagian besar tugas.',
        'gemini-2.0-flash-exp': 'Versi eksperimental (uji coba) dari seri 2.0 Flash. Menawarkan fitur terbaru untuk mengumpulkan umpan balik.',
        'gemini-2.0-pro-exp': 'Versi eksperimental lini 2.0 Pro. Model kelas berat untuk tes kemampuan pemecahan masalah rumit.',
        'gemini-2.5-pro': 'Lini model generasi terbaru khusus tugas riset atau komputasi teks terberat.',
        'gemini-pro': 'Model generasi pertama Gemini (Legacy). Stabil namun mulai digantikan oleh versi 1.5 ke atas.',
        'gemini-pro-vision': 'Model generasi pertama dengan integrasi visioner (gambar). Mulai dikonsolidasikan ke seri utama.',
        'gemini-2.0-flash': 'Rilis stabil versi Flash terbaru, kombinasi luar biasa antara kecepatan seketika dan biaya rendah.',
        'text-bison': 'PaLM 2 (Legacy) dasar untuk text generation, klasifikasi, & summarization konvensional.',
        'chat-bison': 'PaLM 2 (Legacy) percakapan (chat-based dialog system).'
    };

    // Default dates (Current month: first day to last day)
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    
    // First day
    const firstDayStr = `${y}-${m}-01`;
    
    // Last day of current month (day 0 of next month)
    const lastDayDate = new Date(y, today.getMonth() + 1, 0);
    const lastDayStr = `${y}-${m}-${lastDayDate.getDate()}`;

    startDateInput.value = firstDayStr;
    endDateInput.value = lastDayStr;

    // Project label map: projectId -> label
    let projectLabels = {};

    // Fetch project labels from backend
    const fetchProjects = async () => {
        try {
            const res = await fetch('/api/projects');
            if (res.ok) {
                const projects = await res.json();
                projects.forEach(p => { projectLabels[p.id] = p.label; });

                if (projectFilter) {
                    projectFilter.innerHTML = '<option value="all">Semua Project</option>';
                    projects.forEach(p => {
                        const opt = document.createElement('option');
                        opt.value = p.id;
                        opt.textContent = p.label || p.id;
                        projectFilter.appendChild(opt);
                    });
                }
            }
        } catch (e) { console.error('Failed to load projects', e); }
    };

    // Current report data and sort state
    let currentData = [];
    let sortDesc = null; // null = default order, true = DESC, false = ASC
    let usageChart = null; // Store chart instance

    // Fetch dynamic pricing
    const fetchPricing = async () => {
        try {
            const res = await fetch('/api/pricing');
            if (res.ok) {
                exactPricing = await res.json();
            }
        } catch (error) {
            console.error('Failed to load dynamic pricing', error);
        }
    };

    // Fetch data from API
    const fetchData = async () => {
        try {
            tableBody.innerHTML = '<tr><td colspan="5" class="text-center loading-text">Loading data...</td></tr>';
            
            const params = new URLSearchParams({
                period: periodSelect.value,
                startDate: startDateInput.value,
                endDate: endDateInput.value,
                projectId: projectFilter ? projectFilter.value : 'all'
            });

            const res = await fetch(`/api/reports?${params}`);
            const json = await res.json();

            if (res.ok) {
                currentData = json.data;
                // Reset sorting when fetching fresh data
                sortDesc = null;
                sortIcon.textContent = '';
                renderTopCards(currentData);
                renderTable(currentData);
                renderDefinitions(currentData);
                renderChart(currentData);
            } else {
                throw new Error(json.error || 'Failed to fetch');
            }
        } catch (error) {
            console.error(error);
            tableBody.innerHTML = `<tr><td colspan="5" class="text-center loading-text" style="color: #f85149;">Error loading data: ${error.message}</td></tr>`;
        }
    };

    // Render table rows
    const renderTable = (data) => {
        if (data.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="5" class="text-center loading-text">No usage data found for the selected period.</td></tr>';
            return;
        }

        tableBody.innerHTML = '';
        data.forEach(item => {
            const tr = document.createElement('tr');
            const total = parseInt(item.total_tokens, 10);
            const inputT = parseInt(item.input_tokens || 0, 10);
            const outputT = parseInt(item.output_tokens || 0, 10);
            const cost = calculateCost(item.model, inputT, outputT);

            // Resolve project label
            const projId = item.project_id || '';
            const projLabel = projectLabels[projId] || projId || '—';
            const projColor = projLabel === 'Dipo' ? '#f0883e' : projLabel === 'Datapedia' ? '#58a6ff' : '#8b949e';

            tr.innerHTML = `
                <td>${item.period_date}</td>
                <td><span style="background: rgba(88, 166, 255, 0.1); color: #58a6ff; padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.85rem;">${item.model}</span></td>
                <td><span style="background: rgba(255,255,255,0.05); color: ${projColor}; padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 0.8rem; font-weight: 600; border: 1px solid ${projColor}40;">${projLabel}</span></td>
                <td class="text-right font-medium">${total.toLocaleString()}</td>
                <td class="text-right" style="color: #3fb950; font-weight: 600;">$${cost.toFixed(4)}</td>
            `;
            tableBody.appendChild(tr);
        });
    };

    // Refresh Pricing Configuration
    const btnRefreshPricing = document.getElementById('btn-refresh-pricing');
    if (btnRefreshPricing) {
        btnRefreshPricing.addEventListener('click', async () => {
            btnRefreshPricing.style.opacity = '0.5';
            btnRefreshPricing.textContent = 'Menyinkronkan...';
            try {
                const res = await fetch('/api/sync-pricing', { method: 'POST' });
                if (res.ok) {
                    const json = await res.json();
                    exactPricing = json.data;
                    if (currentData.length > 0) {
                        renderTopCards(currentData);
                        renderTable(currentData);
                        renderChart(currentData);
                    }
                    showModal('Sinkronisasi Berhasil', 'Kamus cost berhasil ditarik dan diperbarui dari internet!');
                } else {
                    showModal('Gagal', 'Gagal menyambung ke internet untuk update cost.', true);
                }
            } catch (err) {
                showModal('Error Koneksi', 'Akses internet bermasalah saat sinkronisasi.', true);
            }
            btnRefreshPricing.style.opacity = '1';
            btnRefreshPricing.textContent = '🔄 Refresh Cost';
        });
    }

    // Sync GCP
    btnSync.addEventListener('click', async () => {
        btnSync.classList.add('spinning');
        btnSync.disabled = true;
        try {
            const bodyData = {
                startDate: startDateInput.value,
                endDate: endDateInput.value
            };
            
            const res = await fetch('/api/sync-gcp', { 
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(bodyData)
            });
            
            const json = await res.json();
            if (res.ok) {
                // Build per-project breakdown if available
                let detail = '';
                if (json.projects && json.projects.length > 1) {
                    detail = '<br><br><table style="width:100%;margin-top:8px;border-collapse:collapse;">' +
                        '<tr style="opacity:0.6;font-size:0.8rem;"><th style="text-align:left;padding:4px 8px;">Project</th><th style="text-align:right;padding:4px 8px;">Records</th></tr>' +
                        json.projects.map(p => {
                            const color = p.label === 'Dipo' ? '#f0883e' : '#58a6ff';
                            return `<tr><td style="padding:4px 8px;"><span style="color:${color};font-weight:600;">${p.label}</span></td><td style="text-align:right;padding:4px 8px;">${p.count}</td></tr>`;
                        }).join('') +
                        `<tr style="border-top:1px solid rgba(255,255,255,0.1);"><td style="padding:6px 8px;font-weight:600;">Total</td><td style="text-align:right;padding:6px 8px;font-weight:600;">${json.totalInserted}</td></tr>` +
                        '</table>';
                } else {
                    detail = ` Memasukkan <strong>${json.totalInserted ?? json.count}</strong> record baru.`;
                }
                showModal('Sinkronisasi Sukses', `Operasi sinkronisasi GCP selesai!${detail}`);
                fetchData();
                fetchProjects(); // Refresh labels in case projects changed
            } else {
                showModal('Sinkronisasi Gagal', `Alasan: ${json.error}`, true);
            }
        } catch (error) {
            showModal('Terjadi Kendala', `Sistem gagal menyinkronkan data: ${error.message}`, true);
        } finally {
            btnSync.classList.remove('spinning');
            btnSync.disabled = false;
        }
    });

    // Jump to Chart
    const btnJumpChart = document.getElementById('btn-jump-chart');
    if (btnJumpChart) {
        btnJumpChart.addEventListener('click', () => {
            const chartSection = document.getElementById('chart-section');
            if (chartSection) {
                chartSection.scrollIntoView({ behavior: 'smooth' });
            }
        });
    }

    // Back to top
    const btnBackToTop = document.getElementById('btn-back-to-top');
    if (btnBackToTop) {
        btnBackToTop.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    // Render definitions dynamically for TOP 1 model only
    const renderDefinitions = (data) => {
        if (!definitionsGrid) return;
        
        definitionsGrid.innerHTML = '';
        
        if (!data || data.length === 0) {
            definitionsGrid.innerHTML = '<p style="color: var(--text-muted); padding: 1rem;">Belum ada data model pada periode ini.</p>';
            return;
        }

        // Aggregate tokens per model in current view
        const modelUsage = {};
        data.forEach(item => {
            const m = item.model;
            modelUsage[m] = (modelUsage[m] || 0) + parseInt(item.total_tokens, 10);
        });

        // Sort models by usage descending and get top 6
        const topModels = Object.entries(modelUsage)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6);

        topModels.forEach(([model, tokens], index) => {
            let baseName = model.replace('models/', '');
            let description = modelDictionary[baseName];
            
            if (!description) {
                // Enhanced dictionary fallback logic for accurate descriptions
                let capabilities = [];
                if (baseName.includes('-vision') || baseName.includes('-image')) {
                    capabilities.push('pemrosesan atau pembuatan visual/gambar (Vision & Image Generation)');
                }
                if (baseName.includes('-audio')) {
                    capabilities.push('pemahaman atau pembuatan suara (Audio Processing)');
                }
                if (baseName.includes('text-embedding')) {
                    capabilities.push('konversi teks menjadi metadata vektor (Embeddings) untuk pencarian pintar');
                }
                
                let tier = 'generik dari Google';
                if (baseName.includes('-exp')) tier = 'eksperimental (uji coba fitur terbaru Google)';
                else if (baseName.includes('-pro')) tier = 'kelas "Pro" yang berfokus pada ketepatan, konteks, dan analisis mendalam';
                else if (baseName.includes('-flash')) tier = 'kelas "Flash" yang berfokus pada efisiensi biaya dan kecepatan tinggi';
                else if (baseName.includes('-ultra')) tier = 'kelas "Ultra" untuk performa komputasi tercanggih';

                description = `Model ${tier}. `;
                if (capabilities.length > 0) {
                    description += `Varian model ini dirancang khusus untuk kemampuan ${capabilities.join(' dan ')}.`;
                } else {
                    description += `Dioptimalkan untuk memproses teks, instruksi, dan percakapan secara efisien.`;
                }
            }

            let medal = '';
            if (index === 0) medal = '🥇 ';
            else if (index === 1) medal = '🥈 ';
            else if (index === 2) medal = '🥉 ';
            else medal = `#${index + 1} `;

            const div = document.createElement('div');
            div.className = 'def-item';
            div.innerHTML = `
                <span class="def-title">${medal}Top Penggunaan: ${baseName}</span>
                <p style="margin-bottom: 0.5rem; font-size: 0.85rem; color: #58a6ff;">Total Pemakaian: <strong>${tokens.toLocaleString()}</strong> tokens</p>
                <p>${description}</p>
            `;
            definitionsGrid.appendChild(div);
        });
    };

    // Render Summary Top 5 Cards
    const renderTopCards = (data) => {
        const container = document.getElementById('top-models-container');
        const wrapper = document.getElementById('summary-wrapper');
        if (!container) return;

        container.innerHTML = '';

        if (!data || data.length === 0) {
            if (wrapper) wrapper.style.display = 'none';
            return;
        }

        if (wrapper) wrapper.style.display = 'block';

        // Aggregate tokens and costs per model
        const modelUsage = {};
        data.forEach(item => {
            const m = item.model;
            if (!modelUsage[m]) {
                modelUsage[m] = { tokens: 0, input: 0, output: 0 };
            }
            modelUsage[m].tokens += parseInt(item.total_tokens, 10);
            modelUsage[m].input += parseInt(item.input_tokens || 0, 10);
            modelUsage[m].output += parseInt(item.output_tokens || 0, 10);
        });

        // Sort descending and get top 5
        const topModels = Object.entries(modelUsage)
            .sort((a, b) => b[1].tokens - a[1].tokens)
            .slice(0, 5);

        const medals = ['🥇', '🥈', '🥉', '4', '5'];

        topModels.forEach(([model, stats], index) => {
            let baseName = model.replace('models/', '');
            let cost = calculateCost(baseName, stats.input, stats.output);
            
            // Format number gracefully (e.g., 1.5M, 500K)
            let formattedTokens = stats.tokens.toLocaleString();
            if (stats.tokens >= 1000000) {
                formattedTokens = (stats.tokens / 1000000).toFixed(2) + 'M';
            } else if (stats.tokens >= 1000) {
                formattedTokens = (stats.tokens / 1000).toFixed(1) + 'K';
            }

            const card = document.createElement('div');
            card.className = 'stat-card';
            card.innerHTML = `
                <span class="stat-rank">${medals[index] || ''}</span>
                <span class="stat-title" title="${baseName}">${baseName}</span>
                <span class="stat-value" title="${stats.tokens.toLocaleString()} tokens">${formattedTokens} <span style="font-size:1rem; color:#3fb950; font-weight: 500;">≈ $${cost.toFixed(2)}</span></span>
            `;
            container.appendChild(card);
        });
    };

    // Render Line Chart
    const renderChart = (data) => {
        const ctx = document.getElementById('usage-chart');
        if (!ctx) return;

        if (!data || data.length === 0) {
            if (usageChart) {
                usageChart.destroy();
                usageChart = null;
            }
            return;
        }

        // 1. Extract and sort unique dates/periods for the X-axis (chronological ASC)
        const periods = [...new Set(data.map(d => d.period_date))].sort((a, b) => new Date(a) - new Date(b));

        // 2. Extract unique models for the datasets (lines)
        const models = [...new Set(data.map(d => d.model))];

        // Curated modern color palette
        const colors = [
            '#58a6ff', '#3fb950', '#a371f7', '#f85149', 
            '#d29922', '#ff7b72', '#ec6547', '#8957e5'
        ];

        // 3. Match token_count for each model per period
        const datasets = models.map((model, index) => {
            const dataPoints = periods.map(period => {
                const record = data.find(d => d.period_date === period && d.model === model);
                return record ? parseInt(record.total_tokens, 10) : 0;
            });

            const costPoints = periods.map(period => {
                const record = data.find(d => d.period_date === period && d.model === model);
                if (record) {
                    return calculateCost(model, parseInt(record.input_tokens || 0, 10), parseInt(record.output_tokens || 0, 10));
                }
                return 0;
            });

            return {
                label: model.replace('models/', ''),
                data: dataPoints,
                costs: costPoints,
                borderColor: colors[index % colors.length],
                backgroundColor: colors[index % colors.length],
                tension: 0.35, // Smooth Bezier curves
                pointRadius: 4,
                pointHoverRadius: 6,
                borderWidth: 2
            };
        });

        // 4. Update or Create Chart
        if (usageChart) {
            usageChart.data.labels = periods;
            usageChart.data.datasets = datasets;
            usageChart.update();
        } else {
            usageChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: periods,
                    datasets: datasets
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            labels: {
                                color: '#8b949e', // Mutated text color
                                font: { family: 'Inter', size: 12 }
                            }
                        },
                        tooltip: {
                            mode: 'nearest',
                            intersect: true,
                            callbacks: {
                                title: function(context) {
                                    return 'Periode: ' + context[0].label;
                                },
                                label: function(context) {
                                    let label = context.dataset.label || '';
                                    if (label) label += ' ➔ ';
                                    if (context.parsed.y !== null) {
                                        const cost = context.dataset.costs[context.dataIndex];
                                        label += context.parsed.y.toLocaleString() + ' tokens (≈ $' + cost.toFixed(4) + ')';
                                    }
                                    return label;
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            ticks: { color: '#8b949e' },
                            grid: { color: 'rgba(255,255,255,0.05)', drawBorder: false }
                        },
                        y: {
                            beginAtZero: true,
                            ticks: { 
                                color: '#8b949e',
                                callback: function(value) {
                                    if (value >= 1000000) return (value / 1000000).toFixed(1) + 'M';
                                    if (value >= 1000) return (value / 1000).toFixed(1) + 'K';
                                    return value;
                                }
                            },
                            grid: { color: 'rgba(255,255,255,0.05)', drawBorder: false }
                        }
                    },
                    interaction: { mode: 'nearest', intersect: true }
                }
            });
        }
    };

    // Event Listeners for filters
    periodSelect.addEventListener('change', fetchData);
    startDateInput.addEventListener('change', fetchData);
    endDateInput.addEventListener('change', fetchData);
    if (projectFilter) {
        projectFilter.addEventListener('change', fetchData);
    }

    // Sorting Logic
    sortTokensHeader.addEventListener('click', () => {
        if (!currentData || currentData.length === 0) return;
        
        // Toggle sort direction
        if (sortDesc === null) sortDesc = true;
        else sortDesc = !sortDesc;

        currentData.sort((a, b) => {
            return sortDesc 
                ? b.total_tokens - a.total_tokens 
                : a.total_tokens - b.total_tokens;
        });

        sortIcon.textContent = sortDesc ? ' ▼' : ' ▲';
        renderTable(currentData);
    });

    // Export CSV
    btnExportCSV.addEventListener('click', () => {
        if (!currentData || currentData.length === 0) return showModal('Informasi', 'Tidak ada riwayat penggunaan pada periode ini untuk diekspor.', true);
        
        const headers = ["Period", "Model", "Total Tokens", "Est. Cost (USD)"];
        const rows = currentData.map(row => {
            const cost = calculateCost(row.model, row.input_tokens || 0, row.output_tokens || 0);
            return `"${row.period_date}","${row.model}","${row.total_tokens}","${cost.toFixed(4)}"`;
        });
        const csvContent = [headers.join(','), ...rows].join('\n');
        
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `gemini-usage-${periodSelect.value}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });

    // Export Excel (requires SheetJS included in HTML)
    btnExportXLS.addEventListener('click', () => {
        if (!currentData || currentData.length === 0) return showModal('Informasi', 'Tidak ada riwayat penggunaan pada periode ini untuk diekspor.', true);
        
        if (typeof XLSX === 'undefined') {
            return showModal('Sistem Memproses', 'Sistem pengekskpor Excel sedang dimuat browser. Harap tunggu sebentar lalu coba lagi.', true);
        }

        const wsData = [
            ["Period", "Model", "Total Tokens", "Est. Cost (USD)"],
            ...currentData.map(row => {
                const cost = calculateCost(row.model, row.input_tokens || 0, row.output_tokens || 0);
                return [row.period_date, row.model, row.total_tokens, Number(cost.toFixed(4))];
            })
        ];
        
        const ws = XLSX.utils.aoa_to_sheet(wsData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Usage Data");
        
        XLSX.writeFile(wb, `gemini-usage-${periodSelect.value}.xlsx`);
    });

    // Initial fetch sequence
    fetchProjects().then(() => fetchPricing()).then(() => fetchData());
});
