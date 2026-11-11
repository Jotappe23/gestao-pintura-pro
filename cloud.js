const cloudPanel = $('cloud-panel');
const cloudMessage = $('cloud-message');
const cloudForm = $('cloud-login');
const cloudRetry = $('cloud-retry');
const cloudStatus = $('cloud-status');
const cloudLayout = document.querySelector('.layout');
const cloudConfig = window.ALS_CLOUD_CONFIG;
const recoveryUrl = new URL(location.href);
let signupConfirmation = recoveryUrl.searchParams.has('confirmar');
const recoveryHash = new URLSearchParams(recoveryUrl.hash.slice(1));
let recoveryRequested = recoveryUrl.searchParams.has('recuperar') || recoveryHash.get('type') === 'recovery';
let recoveryToken = recoveryHash.get('type') === 'recovery';
const cloud = cloudConfig?.url && cloudConfig.publishableKey && window.supabase
  ? window.supabase.createClient(cloudConfig.url, cloudConfig.publishableKey)
  : null;

const cloudTitle = $('cloud-title');
cloudForm.insertAdjacentHTML('beforeend', '<p style="text-align:center;margin:16px 0 0"><a href="?recuperar=1" data-auth-screen="request" style="color:#ffafb2">Esqueci minha senha</a> · <a href="?criar=1" data-auth-screen="signup" style="color:#ffafb2">Criar conta</a></p>');
const loginFields = cloudForm.innerHTML;
let authScreen = 'login';
let recoverySession = false;

cloud?.auth.onAuthStateChange(event => {
  if (event === 'PASSWORD_RECOVERY') recoverySession = true;
});

function showAuthScreen(screen, message, email = '') {
  authScreen = screen;
  const request = screen === 'request';
  const reset = screen === 'reset';
  const signup = screen === 'signup';
  cloudTitle.textContent = request ? 'Recuperar senha' : reset ? 'Defina uma nova senha' : signup ? 'Criar conta' : 'Acesse sua oficina';
  cloudForm.innerHTML = request
    ? `<div class="cloud-field">
         <label for="recovery-email">E-mail da oficina</label>
         <input id="recovery-email" name="email" type="email" autocomplete="email" required>
       </div>
       <p><button type="submit">Enviar link de recuperação</button></p>
       <a href="#painel" style="color:#ffafb2">Voltar ao login</a>`
    : reset
      ? `<div class="cloud-field">
           <label for="recovery-password">Nova senha</label>
           <input id="recovery-password" name="password" type="password" autocomplete="new-password" minlength="6" required>
         </div>
         <div class="cloud-field">
           <label for="confirm-password">Confirme a nova senha</label>
           <input id="confirm-password" name="confirmation" type="password" autocomplete="new-password" minlength="6" required>
         </div>
         <p><button type="submit">Salvar nova senha</button></p>`
      : signup
        ? `<div class="cloud-field">
             <label for="signup-email">E-mail da oficina</label>
             <input id="signup-email" name="email" type="email" autocomplete="username" required>
           </div>
           <div class="cloud-field">
             <label for="signup-password">Senha</label>
             <input id="signup-password" name="password" type="password" autocomplete="new-password" minlength="6" required>
           </div>
           <div class="cloud-field">
             <label for="confirm-password">Confirme a senha</label>
             <input id="confirm-password" name="confirmation" type="password" autocomplete="new-password" minlength="6" required>
           </div>
           <p><button type="submit">Criar conta</button></p>
           <a href="#painel" style="color:#ffafb2">Voltar ao login</a>`
        : loginFields;
  if (request) $('recovery-email').value = email;
  if (signup) $('signup-email').value = email;
  cloudGate(message, true);
}

function openAuthPanel() {
  const url = new URL(location.href);
  url.searchParams.delete('recuperar');
  url.searchParams.delete('confirmar');
  url.searchParams.delete('criar');
  url.hash = 'painel';
  history.replaceState(null, '', url);
  syncIntro(true);
}

cloudForm.addEventListener('click', event => {
  const link = event.target.closest('a');
  if (!link || authScreen === 'reset') return;
  event.preventDefault();
  if (cloudForm.querySelector('button').disabled) return;
  if (authScreen === 'login') {
    const email = $('cloud-email').value;
    if (link.dataset.authScreen === 'signup') {
      showAuthScreen('signup', 'Use seu e-mail e uma senha de pelo menos seis caracteres.', email);
      $('signup-email').focus();
    } else {
      showAuthScreen('request', 'Informe o e-mail que você usa para entrar.', email);
      $('recovery-email').focus();
    }
  } else {
    showAuthScreen('login', 'Entre com a conta da oficina para abrir os cadastros.');
    $('cloud-email').focus();
  }
});

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
    if (recoveryRequested || recoverySession) {
      openAuthPanel();
      if (!error && session && (recoverySession || recoveryToken)) {
        showAuthScreen('reset', 'Escolha uma nova senha para sua conta.');
      } else {
        showAuthScreen('request', 'O link está inválido ou expirou. Solicite um novo.');
      }
      return;
    }
    if (signupConfirmation) {
      signupConfirmation = false;
      openAuthPanel();
      if (error || recoveryHash.has('error') || !session) {
        showAuthScreen('login', 'Não foi possível confirmar o e-mail pelo link. Tente entrar ou solicite a recuperação da senha.');
        return;
      }
    }
    if (error) throw error;
    if (!session && recoveryUrl.searchParams.has('criar')) {
      recoveryUrl.searchParams.delete('criar');
      openAuthPanel();
      showAuthScreen('signup', 'Use seu e-mail e uma senha de pelo menos seis caracteres.');
      return;
    }
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
  if ((authScreen === 'reset' || authScreen === 'signup') && form.get('password') !== form.get('confirmation')) {
    cloudMessage.textContent = 'As senhas precisam ser iguais.';
    $('confirm-password').focus();
    return;
  }
  submit.disabled = true;
  try {
    if (authScreen === 'signup') {
      const email = form.get('email').trim();
      const redirect = new URL(location.pathname, location.origin);
      redirect.searchParams.set('confirmar', '1');
      const { data, error } = await cloud.auth.signUp({
        email,
        password: form.get('password'),
        options: { emailRedirectTo: redirect.href }
      });
      if (error) {
        cloudMessage.textContent = error.code === 'signup_disabled'
          ? 'O cadastro de novas contas está desativado.'
          : error.code === 'weak_password'
            ? 'Escolha uma senha mais forte e tente novamente.'
            : 'Não foi possível criar a conta. Confira os dados e tente novamente em alguns instantes.';
        return;
      }
      if (data.session) {
        cloudForm.reset();
        await loadCloud();
      } else {
        showAuthScreen('login', 'Confira seu e-mail e a pasta de spam para confirmar a conta. Se já tiver uma conta, entre com sua senha.');
        $('cloud-email').value = email;
        $('cloud-title').focus();
      }
      return;
    }
    if (authScreen === 'request') {
      const redirect = new URL(location.pathname, location.origin);
      redirect.searchParams.set('recuperar', '1');
      const { error } = await cloud.auth.resetPasswordForEmail(form.get('email').trim(), {
        redirectTo: redirect.href
      });
      cloudMessage.textContent = error
        ? 'Não foi possível enviar o link agora. Tente novamente em alguns instantes.'
        : 'Se o e-mail estiver cadastrado, você receberá um link. Confira também o spam.';
      return;
    }
    if (authScreen === 'reset') {
      const { error } = await cloud.auth.updateUser({ password: form.get('password') });
      if (error) {
        cloudMessage.textContent = error.code === 'same_password'
          ? 'Escolha uma senha diferente da anterior.'
          : 'Não foi possível salvar a senha. Confira os requisitos e tente novamente.';
        return;
      }
      recoveryRequested = false;
      recoveryToken = false;
      recoverySession = false;
      showAuthScreen('login', 'Senha atualizada.');
      await loadCloud();
      if (cloudPanel.hidden) cloudStatus.textContent = 'Senha atualizada · Dados salvos online';
      return;
    }
    const { error } = await cloud.auth.signInWithPassword({
      email: form.get('email'),
      password: form.get('password')
    });
    if (error) throw error;
    cloudForm.reset();
    await loadCloud();
  } catch (error) {
    cloudMessage.textContent = authScreen === 'login'
      ? 'Não foi possível entrar. Confira a conta e a conexão.'
      : 'Confira sua conexão e tente novamente.';
  } finally {
    submit.disabled = false;
  }
});
cloudRetry.addEventListener('click', loadCloud);
loadCloud();
