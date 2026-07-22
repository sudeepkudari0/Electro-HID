def get_trigger_script():
    return """
        (() => {
          function inject() {
            if (document.getElementById('synapse-autofill-host')) return;
            if (!document.body) return;

            const host = document.createElement('div');
            host.id = 'synapse-autofill-host';
            host.style.cssText = 'position: fixed; bottom: 24px; right: 24px; z-index: 2147483647; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; pointer-events: auto;';
            
            const shadow = host.attachShadow({ mode: 'open' });
            
            const style = document.createElement('style');
            style.textContent = `
                .container {
                  display: flex;
                  flex-direction: column;
                  align-items: flex-end;
                  gap: 12px;
                }
                .btn-row {
                  display: flex;
                  gap: 8px;
                  align-items: center;
                }
                button {
                  background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%) !important;
                  color: #ffffff !important;
                  border: 1px solid rgba(255, 255, 255, 0.2) !important;
                  border-radius: 9999px !important;
                  padding: 10px 20px !important;
                  font-weight: 600 !important;
                  font-size: 14px !important;
                  cursor: pointer !important;
                  box-shadow: 0 8px 20px rgba(99, 102, 241, 0.35) !important;
                  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
                  display: flex !important;
                  align-items: center !important;
                  gap: 8px !important;
                  margin: 0 !important;
                  position: static !important;
                }
                button:hover {
                  transform: translateY(-2px) !important;
                  box-shadow: 0 12px 30px rgba(99, 102, 241, 0.45) !important;
                }
                button:active {
                  transform: translateY(0) !important;
                }
                button.hidden {
                  display: none !important;
                }
                button.modal-active-btn {
                  background: linear-gradient(135deg, #10b981 0%, #059669 100%) !important;
                  box-shadow: 0 8px 20px rgba(16, 185, 129, 0.35) !important;
                }

                .details-card {
                  width: 320px !important;
                  background: rgba(15, 23, 42, 0.95) !important;
                  backdrop-filter: blur(12px) !important;
                  border: 1px solid rgba(255, 255, 255, 0.15) !important;
                  border-radius: 16px !important;
                  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4) !important;
                  color: #f1f5f9 !important;
                  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
                  padding: 16px !important;
                  display: flex !important;
                  flex-direction: column !important;
                  gap: 12px !important;
                  animation: slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) !important;
                  position: relative !important;
                  z-index: 2147483647 !important;
                  margin: 0 !important;
                }
                .details-card.hidden {
                  display: none !important;
                }

                @keyframes slideIn {
                  from {
                    transform: translateY(20px) !important;
                    opacity: 0 !important;
                  }
                  to {
                    transform: translateY(0) !important;
                    opacity: 1 !important;
                  }
                }

                .card-header {
                  display: flex !important;
                  justify-content: space-between !important;
                  align-items: center !important;
                  border-bottom: 1px solid rgba(255, 255, 255, 0.1) !important;
                  padding-bottom: 8px !important;
                }
                .card-title {
                  font-weight: 600 !important;
                  font-size: 13px !important;
                  color: #a5b4fc !important;
                  display: flex !important;
                  align-items: center !important;
                  gap: 6px !important;
                }
                .close-btn {
                  background: transparent !important;
                  border: none !important;
                  color: #94a3b8 !important;
                  cursor: pointer !important;
                  padding: 4px !important;
                  font-size: 16px !important;
                  line-height: 1 !important;
                  box-shadow: none !important;
                }
                .close-btn:hover {
                  color: #f1f5f9 !important;
                  transform: none !important;
                }
                .status-badge {
                  align-self: flex-start !important;
                  background: rgba(99, 102, 241, 0.2) !important;
                  border: 1px solid rgba(99, 102, 241, 0.4) !important;
                  color: #c7d2fe !important;
                  font-size: 11px !important;
                  padding: 2px 8px !important;
                  border-radius: 6px !important;
                  font-weight: 500 !important;
                }
                .fields-list {
                  max-height: 180px !important;
                  overflow-y: auto !important;
                  display: flex !important;
                  flex-direction: column !important;
                  gap: 6px !important;
                  font-size: 12px !important;
                }
                .field-item {
                  display: flex !important;
                  justify-content: space-between !important;
                  background: rgba(255, 255, 255, 0.03) !important;
                  padding: 6px 8px !important;
                  border-radius: 6px !important;
                }
                .field-name {
                  color: #94a3b8 !important;
                  overflow: hidden !important;
                  text-overflow: ellipsis !important;
                  white-space: nowrap !important;
                  max-width: 140px !important;
                }
                .field-val {
                  color: #38bdf8 !important;
                  font-weight: 500 !important;
                }
                .log-area {
                  font-size: 11px !important;
                  color: #64748b !important;
                  max-height: 80px !important;
                  overflow-y: auto !important;
                  border-top: 1px solid rgba(255, 255, 255, 0.05) !important;
                  padding-top: 8px !important;
                  display: flex !important;
                  flex-direction: column !important;
                  gap: 4px !important;
                }
                .log-entry {
                  display: flex !important;
                  gap: 6px !important;
                }
                .log-time {
                  color: #475569 !important;
                }
            `;
            shadow.appendChild(style);
            
            const container = document.createElement('div');
            container.className = 'container';
            
            const detailsCard = document.createElement('div');
            detailsCard.className = 'details-card hidden';
            detailsCard.id = 'llm-details';
            detailsCard.innerHTML = `
              <div class="card-header">
                <div class="card-title"><span>🤖</span> AI Decision Log</div>
                <button class="close-btn" id="close-card-btn">×</button>
              </div>
              <div class="status-badge" id="llm-status">Ready</div>
              <div class="fields-list" id="llm-fields"></div>
              <div class="log-area" id="llm-logs"></div>
            `;
            container.appendChild(detailsCard);

            const btnRow = document.createElement('div');
            btnRow.className = 'btn-row';

            const modalBtn = document.createElement('button');
            modalBtn.id = 'synapse-floating-modal-btn';
            modalBtn.className = 'modal-active-btn hidden';
            modalBtn.innerHTML = '✨ AI Fill Modal Step';
            modalBtn.onclick = (e) => {
              e.preventDefault();
              e.stopPropagation();
              modalBtn.innerHTML = '⏳ Filling Step...';
              modalBtn.disabled = true;
              if (window.triggerModalAutofill) {
                window.triggerModalAutofill();
              }
            };
            btnRow.appendChild(modalBtn);

            const mainBtn = document.createElement('button');
            mainBtn.innerHTML = '⚡ Autofill Form';
            mainBtn.onclick = (e) => {
              e.preventDefault();
              e.stopPropagation();
              if (window.triggerAutofill) {
                window.triggerAutofill();
              }
            };
            btnRow.appendChild(mainBtn);

            const resumeBtn = document.createElement('button');
            resumeBtn.id = 'resume-btn';
            resumeBtn.className = 'hidden';
            resumeBtn.style.cssText = 'background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%) !important; border: 1px solid rgba(255,255,255,0.2) !important;';
            resumeBtn.innerHTML = '📄 Check Resume';
            resumeBtn.onclick = (e) => {
              e.preventDefault();
              e.stopPropagation();
              if (window.viewResume) {
                window.viewResume();
              }
            };
            btnRow.appendChild(resumeBtn);

            container.appendChild(btnRow);
            shadow.appendChild(container);
            document.body.appendChild(host);

            shadow.getElementById('close-card-btn').onclick = () => {
              detailsCard.classList.add('hidden');
            };

            // Non-blocking resume check
            setTimeout(() => {
              try {
                if (window.checkResume) {
                  window.checkResume().then((exists) => {
                    if (exists && resumeBtn) {
                      resumeBtn.classList.remove('hidden');
                    }
                  }).catch(() => {});
                }
              } catch (err) {}
            }, 600);
          }

          window.addAutofillLog = (msg, type='info') => {
            const host = document.getElementById('synapse-autofill-host');
            if (!host || !host.shadowRoot) return;
            const shadow = host.shadowRoot;
            
            const logs = shadow.getElementById('llm-logs');
            const card = shadow.getElementById('llm-details');
            const status = shadow.getElementById('llm-status');
            
            if (card && card.classList.contains('hidden') && type !== 'silent') {
              card.classList.remove('hidden');
            }
            if (status) {
              status.textContent = msg;
              if (type === 'error') status.style.background = 'rgba(239, 68, 68, 0.2)';
              else if (type === 'success') status.style.background = 'rgba(16, 185, 129, 0.2)';
              else status.style.background = 'rgba(99, 102, 241, 0.2)';
            }
            if (logs) {
              const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
              const entry = document.createElement('div');
              entry.className = 'log-entry';
              entry.innerHTML = `<span class="log-time">[${time}]</span> <span>${msg}</span>`;
              logs.prepend(entry);
            }
          };

          window.updateAutofillStatus = (statusText, fields=[]) => {
            const host = document.getElementById('synapse-autofill-host');
            if (!host || !host.shadowRoot) return;
            const shadow = host.shadowRoot;
            
            const card = shadow.getElementById('llm-details');
            const status = shadow.getElementById('llm-status');
            const fieldsList = shadow.getElementById('llm-fields');
            
            if (card) card.classList.remove('hidden');
            if (status) status.textContent = statusText;
            if (fieldsList) {
              fieldsList.innerHTML = fields.map(f => `
                <div class="field-item">
                  <span class="field-name" title="${f.label}">${f.label}</span>
                  <span class="field-val">${f.value}</span>
                </div>
              `).join('');
            }
          };

          window.clearAutofillDetails = () => {
            const host = document.getElementById('synapse-autofill-host');
            if (!host || !host.shadowRoot) return;
            const shadow = host.shadowRoot;
            shadow.getElementById('llm-details').classList.add('hidden');
            shadow.getElementById('llm-fields').innerText = '';
          };

          window.resetModalAutofillBtn = (msg) => {
            const btn = document.getElementById('synapse-modal-autofill-btn');
            if (btn) {
              btn.innerHTML = '✨ AI Fill Step';
              btn.disabled = false;
            }
            const host = document.getElementById('synapse-autofill-host');
            if (host && host.shadowRoot) {
              const floatingModalBtn = host.shadowRoot.getElementById('synapse-floating-modal-btn');
              if (floatingModalBtn) {
                floatingModalBtn.innerHTML = '✨ AI Fill Modal Step';
                floatingModalBtn.disabled = false;
              }
            }
            if (msg && window.addAutofillLog) {
              window.addAutofillLog(msg, 'success');
            }
          };

          function injectModalBtn() {
            const rawCandidates = Array.from(document.querySelectorAll('div[role="dialog"], [data-sdui-screen*="EasyApply"], [data-testid="dialog-content"], #dialog-header, .jobs-easy-apply-modal, .artdeco-modal'));
            const allModals = [];
            for (const el of rawCandidates) {
              const dialog = el.closest('div[role="dialog"], dialog') || el;
              if (dialog.getAttribute('aria-hidden') === 'true') continue;
              const style = window.getComputedStyle(dialog);
              if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
              const rect = dialog.getBoundingClientRect();
              if (rect.width > 200 && rect.height > 200) {
                if (!allModals.includes(dialog)) allModals.push(dialog);
              }
            }

            const host = document.getElementById('synapse-autofill-host');
            const floatingModalBtn = host && host.shadowRoot ? host.shadowRoot.getElementById('synapse-floating-modal-btn') : null;

            if (allModals.length === 0) {
              if (floatingModalBtn && !floatingModalBtn.classList.contains('hidden')) {
                floatingModalBtn.classList.add('hidden');
              }
              return;
            }

            // Show our floating modal button right in the widget toolbar
            if (floatingModalBtn && floatingModalBtn.classList.contains('hidden')) {
              floatingModalBtn.classList.remove('hidden');
            }

            for (const modal of allModals) {
              if (modal.querySelector('#synapse-modal-autofill-btn')) continue;

              const btn = document.createElement('button');
              btn.id = 'synapse-modal-autofill-btn';
              btn.type = 'button';
              btn.innerHTML = '✨ AI Fill Step';
              btn.style.cssText = 'background: linear-gradient(135deg, #10b981 0%, #059669 100%) !important; color: #ffffff !important; border: 1px solid rgba(255, 255, 255, 0.2) !important; border-radius: 9999px !important; padding: 6px 14px !important; font-weight: 700 !important; font-size: 13px !important; cursor: pointer !important; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.35) !important; display: inline-flex !important; align-items: center !important; gap: 6px !important; margin: 0 12px !important; z-index: 2147483647 !important; transition: transform 0.2s, box-shadow 0.2s !important;';
              btn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                btn.innerHTML = '⏳ AI Filling Step...';
                btn.disabled = true;
                if (window.triggerModalAutofill) {
                  window.triggerModalAutofill();
                }
              };

              const footer = modal.querySelector('footer, .artdeco-modal__actionbar, .jobs-easy-apply-footer, div[class*="actionbar"], div[class*="footer"]');
              const header = modal.querySelector('#dialog-header, header, .artdeco-modal__header, .jobs-easy-apply-modal__header, [data-test-modal-header], h2');

              if (footer) {
                footer.insertBefore(btn, footer.firstChild);
              } else if (header) {
                if (header.tagName.toLowerCase() === 'h2' && header.parentNode) {
                  header.parentNode.appendChild(btn);
                } else {
                  header.appendChild(btn);
                }
              } else {
                btn.style.position = 'absolute';
                btn.style.top = '14px';
                btn.style.right = '60px';
                modal.appendChild(btn);
              }
            }
          }
          
          let observerTimeout = null;
          function runCheckDebounced() {
            if (observerTimeout) return;
            observerTimeout = setTimeout(() => {
              observerTimeout = null;
              if (!document.getElementById('synapse-autofill-host')) {
                inject();
              }
              injectModalBtn();
            }, 250);
          }

          function startObserver() {
            if (!document.body) {
              setTimeout(startObserver, 50);
              return;
            }
            const observer = new MutationObserver(runCheckDebounced);
            observer.observe(document.body, { childList: true, subtree: true });
          }

          if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
              inject();
              injectModalBtn();
              startObserver();
            });
          } else {
            inject();
            injectModalBtn();
            startObserver();
          }
          
          document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.shiftKey && e.key.toUpperCase() === 'A') {
              e.preventDefault();
              if (window.triggerAutofill) {
                window.triggerAutofill();
              }
            }
          });
        })();
    """
