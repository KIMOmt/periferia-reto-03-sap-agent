document.addEventListener("DOMContentLoaded", () => {
  const chatMessages = document.getElementById("chat-messages");
  const chatForm = document.getElementById("chat-form");
  const chatInput = document.getElementById("chat-input");
  const typingIndicator = document.getElementById("typing-indicator");
  const confirmationBanner = document.getElementById("confirmation-banner");
  const btnConfirmar = document.getElementById("btn-confirmar");
  const btnRechazar = document.getElementById("btn-rechazar");
  const sessionIdDisplay = document.getElementById("session-id-display");
  const toolsCountDisplay = document.getElementById("tools-count-display");

  // Obtener o crear ID de sesión
  let sessionId = localStorage.getItem("sap_agent_session_id");
  if (!sessionId) {
    sessionId = `ses-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    localStorage.setItem("sap_agent_session_id", sessionId);
  }
  if (sessionIdDisplay) {
    sessionIdDisplay.textContent = sessionId;
  }

  let totalToolCalls = 0;

  // Enviar mensaje al backend
  async function sendMessage(text) {
    if (!text.trim()) return;

    // Agregar mensaje del usuario en la UI
    appendMessage("user", text);
    chatInput.value = "";
    confirmationBanner.classList.add("hidden");
    typingIndicator.classList.remove("hidden");
    scrollToBottom();

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message: text })
      });

      typingIndicator.classList.add("hidden");

      if (!response.ok) {
        const errorData = await response.json();
        appendMessage("assistant", `❌ Error del servidor: ${errorData.error || response.statusText}`);
        return;
      }

      const data = await response.json();

      // Renderizar cada llamada a herramienta si hubo
      if (Array.isArray(data.toolCalls) && data.toolCalls.length > 0) {
        totalToolCalls += data.toolCalls.length;
        if (toolsCountDisplay) toolsCountDisplay.textContent = totalToolCalls.toString();

        data.toolCalls.forEach((tc) => {
          appendToolCard(tc.name, tc.args, tc.result);
        });
      }

      // Renderizar respuesta del asistente
      appendMessage("assistant", data.reply);

      // Mostrar banner de confirmación si el agente lo pide
      if (data.needsConfirmation) {
        confirmationBanner.classList.remove("hidden");
        confirmationBanner.scrollIntoView({ behavior: "smooth" });
      }
    } catch (err) {
      typingIndicator.classList.add("hidden");
      appendMessage("assistant", `❌ Error de conexión con el agente: ${err.message}`);
    } finally {
      scrollToBottom();
    }
  }

  function appendMessage(role, content) {
    const msgDiv = document.createElement("div");
    msgDiv.className = `message ${role}-message`;

    const senderDiv = document.createElement("div");
    senderDiv.className = "message-sender";
    senderDiv.textContent = role === "user" ? "👤 Analista" : "🤖 Agente SAP";

    const contentDiv = document.createElement("div");
    contentDiv.className = "message-content";

    // Formatear saltos de línea y negritas básicas
    let formatted = content
      .replace(/\n/g, "<br>")
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");

    contentDiv.innerHTML = formatted;

    msgDiv.appendChild(senderDiv);
    msgDiv.appendChild(contentDiv);
    chatMessages.appendChild(msgDiv);
  }

  function appendToolCard(name, args, result) {
    const card = document.createElement("div");
    card.className = "tool-call-card";

    const isOk = Boolean(result.ok);
    const summary = isOk
      ? JSON.stringify(result.data, null, 2)
      : `Error: ${result.error}`;

    card.innerHTML = `
      <div class="tool-header">
        <span class="tool-title">⚡ Herramienta: <code>${name}</code></span>
        <span class="tool-badge ${isOk ? "badge-ok" : "badge-err"}">${isOk ? "OK" : "ERROR"}</span>
      </div>
      <details class="tool-details">
        <summary>Ver payload JSON</summary>
        <div class="tool-details-content">
          <div class="tool-args"><strong>Argumentos:</strong> <code>${JSON.stringify(args)}</code></div>
          <pre class="tool-result"><strong>Resultado:</strong><br>${summary}</pre>
        </div>
      </details>
    `;

    chatMessages.appendChild(card);
  }

  function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  // Manejar envío de formulario
  chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    sendMessage(chatInput.value);
  });

  // Botones de confirmación
  btnConfirmar.addEventListener("click", () => {
    confirmationBanner.classList.add("hidden");
    sendMessage("Confirmo la excepción. Por favor procede a crear la orden de compra en SAP.");
  });

  btnRechazar.addEventListener("click", () => {
    confirmationBanner.classList.add("hidden");
    sendMessage("No autorizo la excepción. Cancela la creación de la orden.");
  });

  // Botones de casos rápidos en la barra lateral
  document.querySelectorAll(".btn-case").forEach((btn) => {
    btn.addEventListener("click", () => {
      const caso = btn.getAttribute("data-caso");
      if (caso) {
        sendMessage(`Por favor procesa la solicitud '${caso}'.`);
      }
    });
  });
});

