const cloudPanel = $('cloud-panel');
const cloudMessage = $('cloud-message');
const cloudForm = $('cloud-login');
const cloudRetry = $('cloud-retry');
const cloudStatus = $('cloud-status');
const cloudLayout = document.querySelector('.layout');
const cloudConfig = window.ALS_CLOUD_CONFIG;
const cloud = cloudConfig?.url && cloudConfig.publishableKey && window.supabase
  ? window.supabase.createClient(cloudConfig.url, cloudConfig.publishableKey)
  : null;

let cloudOwner = null;
let cloudRevision = null;
let cloudConfirmed = null;
let cloudPending = null;

function cloudGate(message, showLogin = false, showRetry = false) {
  cloudLayout.classList.add('cloud-locked');
  cloudPanel.hidden = false;
  cloudMessage.textContent = message;
  cloudForm.hidden = !showLogin;
  cloudRetry.hidden = !showRetry;
}

function legacyRecords() {
  const stored = localStorage.getItem(KEY);
  if (!stored) return null;
  const records = JSON.parse(stored);
  if (!['clientes', 'produtos', 'servicos', 'despesas'].every(key => Array.isArray(records?.[key]))) {
    throw new Error('Os registros deste navegador estão em um formato inválido.');
  }
  return records;
}

async function loadCloud() {
  cloudGate('Conectando ao armazenamento online…');
  if (!cloud) {
    cloudGate('A conexão com o Supabase precisa ser configurada.');
    return;
  }
  try {
    const { data: { session }, error } = await cloud.auth.getSession();
    if (error) throw error;
    if (!session) {
      cloudGate('Entre com a conta da oficina para abrir os cadastros.', true);
      return;
    }
    cloudOwner = session.user.id;
    const result = await cloud.from('als_workspace').select('revision,records')
      .eq('owner_id', cloudOwner).maybeSingle();
    if (result.error) throw result.error;
    cloudRevision = result.data?.revision ?? null;
    cloudConfirmed = result.data?.records ?? null;

    if (!cloudConfirmed) {
      const existing = legacyRecords();
      if (existing && !confirm('Enviar os registros deste navegador para sua conta ALS 4x4?')) {
        cloudGate('Os registros continuam neste navegador. Use Tentar novamente para transferir.', false, true);
        return;
      }
      db = existing ?? { clientes: [], produtos: [], servicos: [], despesas: [] };
      if (!await save()) return;
    } else {
      db = structuredClone(cloudConfirmed);
    }
    cloudPanel.hidden = true;
    cloudLayout.classList.remove('cloud-locked');
    cloudStatus.textContent = 'Dados salvos online';
    render();
  } catch (error) {
    cloudGate('Não foi possível carregar os dados online. Verifique a conexão e tente novamente.', false, true);
  }
}

async function save() {
  if (!cloudOwner || cloudPending) return false;
  cloudPending = true;
  const records = structuredClone(db);
  const revision = crypto.randomUUID();
  cloudLayout.inert = true;
  $('form').inert = true;
  cloudStatus.textContent = 'Salvando online…';
  try {
    const table = cloud.from('als_workspace');
    const result = cloudRevision
      ? await table.update({ revision, records }).eq('owner_id', cloudOwner)
        .eq('revision', cloudRevision).select('revision').maybeSingle()
      : await table.insert({ owner_id: cloudOwner, revision, records }).select('revision').single();

    if (result.data?.revision !== revision) {
      // Uma resposta perdida pode ter ocorrido depois de o banco confirmar a gravação.
      const current = await cloud.from('als_workspace').select('revision,records')
        .eq('owner_id', cloudOwner).maybeSingle();
      if (current.error) throw current.error;
      if (current.data?.revision !== revision) {
        if (current.data && current.data.revision !== cloudRevision) {
          cloudRevision = current.data.revision;
          cloudConfirmed = current.data.records;
          db = structuredClone(cloudConfirmed);
          modal.close();
          render();
          cloudStatus.textContent = 'Dados atualizados de outro dispositivo';
          alert('Outro dispositivo atualizou os dados. Confira os registros atuais e refaça a alteração.');
          return false;
        }
        throw result.error ?? new Error('Gravação online sem confirmação.');
      }
    }
    cloudRevision = revision;
    cloudConfirmed = records;
    cloudStatus.textContent = 'Dados salvos online';
    render();
    return true;
  } catch (error) {
    if (cloudConfirmed) {
      db = structuredClone(cloudConfirmed);
      cloudStatus.textContent = 'Alteração sem confirmação';
      // O formulário permanece aberto. Reabra-o se a alteração já aparecer após atualizar.
      alert('Não foi possível confirmar o salvamento online. Confira a conexão e tente novamente.');
    } else {
      cloudGate('Não foi possível confirmar o envio dos registros. Tente novamente.', false, true);
    }
    return false;
  } finally {
    cloudPending = null;
    cloudLayout.inert = false;
    $('form').inert = false;
  }
}

cloudForm.addEventListener('submit', async event => {
  event.preventDefault();
  const form = new FormData(cloudForm);
  const submit = cloudForm.querySelector('button');
  submit.disabled = true;
  try {
    const { error } = await cloud.auth.signInWithPassword({
      email: form.get('email'),
      password: form.get('password')
    });
    if (error) throw error;
    cloudForm.reset();
    await loadCloud();
  } catch (error) {
    cloudMessage.textContent = 'Não foi possível entrar. Confira a conta e a conexão.';
  } finally {
    submit.disabled = false;
  }
});
cloudRetry.addEventListener('click', loadCloud);
loadCloud();
