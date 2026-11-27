'use strict';

const byId = id => document.getElementById(id);
const status = byId('app-status');

function tell(message) {
  status.textContent = message;
  status.hidden = !message;
}

if (!window.supabase) {
  tell('โหลดส่วนเชื่อมต่อ Supabase ไม่ได้ ลองตรวจอินเทอร์เน็ตแล้วรีโหลด');
} else {
  start(window.supabase.createClient(
    'https://rcloqsbgcjyadpxyyxgq.supabase.co',
    'sb_publishable_BZZvEhr5mCr24KyUcuTqQg_JXwj6PHp'
  ));
}

function start(client) {
  const bucket = client.storage.from('artelier-photos');
  let sessionId;
  let selected = null;
  let previewPhoto = null;
  let pageVersion = 0;
  let busy = false;
  let frames = [];
  let photoCount = 0;

  function updateFrameControls() {
    const connected = !!byId('frame-select').value;
    byId('play').disabled = !connected || !photoCount;
    byId('play-local').disabled = !connected;
  }

  async function refreshFrames() {
    const user = sessionId;
    if (!user) return;
    const devices = await result(client.from('frames').select('id,name,last_seen_at').order('created_at'));
    if (sessionId !== user) return;
    const select = byId('frame-select');
    if (JSON.stringify(devices.map(({id,name}) => [id,name])) !==
        JSON.stringify(frames.map(({id,name}) => [id,name]))) {
      const previous = select.value;
      select.replaceChildren(...devices.map(frame => new Option(frame.name, frame.id)));
      if (devices.some(frame => frame.id === previous)) select.value = previous;
    }
    frames = devices;
    updateFrameControls();
    const device = frames.find(frame => frame.id === select.value);
    if (!device) {
      byId('frame-summary').textContent = 'ยังไม่ได้จับคู่';
      return;
    }
    const playback = await result(client.from('frame_playback').select('status,ready_count')
      .eq('frame_id', device.id).maybeSingle());
    if (sessionId !== user || select.value !== device.id) return;
    const online = Date.now() - Date.parse(device.last_seen_at) < 90000;
    const description = online
      ? playback?.status === 'playing'
        ? 'กำลังเล่น' + (playback.ready_count ? ' · ' + playback.ready_count + ' รูป' : '')
        : playback ? 'กำลังรอ Kano รับอัลบั้ม' : 'ออนไลน์'
      : 'ออฟไลน์';
    byId('frame-summary').textContent = device.name + ' · ' + description;
  }

  async function play(album) {
    if (busy || !byId('frame-select').value) return;
    busy = true;
    try {
      await result(client.rpc('artelier_play', {target_frame: byId('frame-select').value, target_album: album}));
      tell('ส่งคำสั่งไป Kano แล้ว');
      byId('frame-status').textContent = 'ส่งคำสั่งไป Kano แล้ว';
      await refreshFrames();
    } catch (error) {
      tell(error.message);
      byId('frame-status').textContent = error.message;
    } finally {
      busy = false;
    }
  }

  byId('pair-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    try {
      const frame = await result(client.rpc('artelier_claim', {
        pair_code: byId('frame-code').value.trim(), frame_name: byId('frame-name').value.trim()
      }));
      byId('frame-code').value = '';
      byId('frame-status').textContent = 'จับคู่สำเร็จ';
      await refreshFrames();
      byId('frame-select').value = frame;
      await refreshFrames();
    } catch (error) {
      byId('frame-status').textContent = error.message;
    } finally {
      busy = false;
    }
  });
  byId('frame-select').addEventListener('change', () => {
    updateFrameControls();
    refreshFrames().catch(() => {});
  });
  byId('play').addEventListener('click', () => { if (selected && photoCount) play(selected.id); });
  byId('play-local').addEventListener('click', () => play(null));
  window.setInterval(() => refreshFrames().catch(() => {}), 10000);

  async function result(query) {
    const {data, error} = await query;
    if (error) throw error;
    return data;
  }

  function button(text, style) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = style;
    el.textContent = text;
    return el;
  }

  function loadPage() {
    const version = ++pageVersion;
    photoCount = 0;
    updateFrameControls();
    byId('home').hidden = !sessionId || !!selected;
    byId('detail').hidden = !sessionId || !selected;
    byId('auth').hidden = !!sessionId;
    if (!sessionId) {
      selected = null;
      byId('albums').replaceChildren();
      byId('photos').replaceChildren();
      return Promise.resolve();
    }
    return (selected ? showAlbum(selected, version) : showAlbums(version))
      .catch(error => { if (version === pageVersion) tell(error.message); });
  }

  function showSession(session) {
    const userId = session?.user.id || null;
    if (sessionId === userId) return;
    sessionId = userId;
    frames = [];
    byId('frame-select').replaceChildren();
    byId('frame-status').textContent = '';
    byId('frame-code').value = '';
    byId('frame-summary').textContent = 'ยังไม่ได้จับคู่';
    refreshFrames().catch(() => {});
    selected = null;
    for (const id of ['preview', 'device-dialog', 'album-dialog']) byId(id).close();
    loadPage();
  }

  async function showAlbums(version) {
    byId('albums').replaceChildren();
    const albums = await result(client.from('albums').select('id,name').order('created_at', {ascending: false}));
    if (version !== pageVersion) return;
    if (!albums.length) {
      byId('albums').textContent = 'ยังไม่มีอัลบั้ม สร้างอัลบั้มแรกเพื่อเพิ่มรูป';
      return;
    }
    byId('albums').replaceChildren(...albums.map(album => {
      const item = document.createElement('article');
      item.className = 'album';
      const name = button(album.name, 'album-name');
      name.addEventListener('click', () => { selected = album; tell(''); loadPage(); });
      item.append(name);
      return item;
    }));
  }

  async function showAlbum(album, version) {
    byId('album-title').textContent = album.name;
    byId('album-count').textContent = 'กำลังโหลดรูป';
    byId('photos').replaceChildren();
    const rows = await result(client.from('album_photos').select('photo_id,photos(object_path)').eq('album_id', album.id).order('added_at'));
    if (version !== pageVersion) return;
    const photos = rows.filter(row => row.photos?.object_path);
    const paths = photos.map(row => row.photos.object_path);
    byId('album-count').textContent = paths.length + ' รูป';
    photoCount = paths.length;
    updateFrameControls();
    if (!paths.length) return;
    const links = await result(bucket.createSignedUrls(paths, 3600));
    if (version !== pageVersion) return;
    const linksByPath = new Map(links.map(link => [link.path, link.signedUrl]));
    byId('photos').replaceChildren(...photos.map((photo, index) => {
      const url = linksByPath.get(photo.photos.object_path);
      const tile = button('', 'thumbnail');
      tile.setAttribute('aria-label', 'ดูรูปที่ ' + (index + 1));
      if (url) {
        const thumb = document.createElement('img');
        thumb.src = url;
        thumb.alt = '';
        thumb.loading = 'lazy';
        thumb.style.cssText = 'display:block;width:100%;height:100%;object-fit:cover';
        tile.append(thumb);
      } else {
        tile.textContent = 'เปิดรูปไม่ได้';
      }
      tile.addEventListener('click', () => {
        previewPhoto = {albumId: album.id, photoId: photo.photo_id};
        const image = byId('photo-open');
        image.hidden = !url;
        if (url) image.src = url;
        byId('remove-status').hidden = !!url;
        byId('remove-status').textContent = url ? '' : 'เปิดรูปไม่ได้';
        byId('preview').showModal();
      });
      return tile;
    }));
  }

  async function authenticate(signup) {
    const form = byId('auth-form');
    if (!form.reportValidity() || busy) return;
    busy = true;
    try {
      const credentials = {email: byId('email').value.trim(), password: byId('password').value};
      if (signup) credentials.options = {emailRedirectTo: location.origin + location.pathname};
      const data = await result(signup ? client.auth.signUp(credentials) : client.auth.signInWithPassword(credentials));
      byId('password').value = '';
      tell(data.session ? '' : 'ตรวจอีเมลเพื่อยืนยันบัญชี แล้วกลับมาลงชื่อเข้าใช้');
      if (data.session) showSession(data.session);
    } catch (error) {
      tell(error.message);
    } finally {
      busy = false;
    }
  }

  byId('auth-form').addEventListener('submit', event => { event.preventDefault(); authenticate(false); });
  byId('signup').addEventListener('click', () => authenticate(true));
  byId('settings').addEventListener('click', () => byId('device-dialog').showModal());
  byId('close-settings').addEventListener('click', () => byId('device-dialog').close());
  byId('signout').addEventListener('click', async () => {
    if (busy) return;
    try { await result(client.auth.signOut()); tell(''); }
    catch (error) { byId('device-dialog').close(); tell(error.message); }
  });
  byId('back').addEventListener('click', () => { selected = null; tell(''); loadPage(); });
  byId('close-photo').addEventListener('click', () => byId('preview').close());
  byId('preview').addEventListener('close', () => {
    previewPhoto = null;
    byId('photo-open').removeAttribute('src');
  });
  byId('remove-photo').addEventListener('click', async () => {
    if (busy || !previewPhoto || !window.confirm('เอารูปนี้ออกจากอัลบั้ม?')) return;
    const {albumId, photoId} = previewPhoto;
    const user = sessionId;
    const remove = byId('remove-photo');
    busy = true;
    remove.disabled = true;
    try {
      await result(client.from('album_photos').delete()
        .eq('album_id', albumId).eq('photo_id', photoId));
      if (sessionId !== user) return;
      if (byId('preview').open) byId('preview').close();
      tell('เอารูปออกจากอัลบั้มแล้ว');
      if (selected?.id === albumId) await loadPage();
    } catch (error) {
      if (sessionId !== user) return;
      if (byId('preview').open) {
        byId('remove-status').textContent = 'เอารูปออกไม่สำเร็จ · ' + error.message;
        byId('remove-status').hidden = false;
      } else {
        tell(error.message);
      }
    } finally {
      busy = false;
      remove.disabled = false;
    }
  });
  byId('new-album').addEventListener('click', () => byId('album-dialog').showModal());
  byId('cancel-album').addEventListener('click', () => byId('album-dialog').close());
  byId('album-form').addEventListener('submit', async event => {
    event.preventDefault();
    const input = byId('album-name');
    if (busy || !input.value.trim()) return;
    busy = true;
    try {
      const album = await result(client.from('albums').insert({name: input.value.trim()}).select('id,name').single());
      input.value = '';
      byId('album-dialog').close();
      selected = album;
      tell('');
      await loadPage();
    } catch (error) {
      byId('album-dialog').close();
      tell(error.message);
    } finally {
      busy = false;
    }
  });

  async function upload(file, album) {
    const photo = await jpeg(file);
    const row = await result(client.from('photos').insert({id: crypto.randomUUID()}).select('id,object_path').single());
    let stored = false;
    try {
      await result(bucket.upload(row.object_path, photo, {contentType:'image/jpeg'}));
      stored = true;
      await result(client.from('album_photos').insert({album_id:album.id, photo_id:row.id}));
    } catch (error) {
      if (stored) await bucket.remove([row.object_path]);
      await client.from('photos').delete().eq('id', row.id);
      throw error;
    }
  }

  byId('add').addEventListener('click', () => byId('picker').click());
  byId('picker').addEventListener('change', async event => {
    if (busy || !selected) return;
    const files = Array.from(event.target.files);
    event.target.value = '';
    if (!files.length) return;
    const album = selected;
    const errors = [];
    busy = true;
    byId('add').disabled = true;
    try {
      for (let index = 0; index < files.length; index++) {
        tell('กำลังส่งรูป ' + (index + 1) + ' จาก ' + files.length);
        try { await upload(files[index], album); }
        catch (error) { errors.push(files[index].name + ' · ' + error.message); }
      }
      await loadPage();
      tell(errors.length ? errors.join(' / ') : 'อัปโหลดสำเร็จ ' + files.length + ' รูป');
    } finally {
      byId('add').disabled = false;
      busy = false;
    }
  });

  client.auth.onAuthStateChange((_event, session) => {
    window.setTimeout(() => showSession(session), 0);
  });
  result(client.auth.getSession()).then(data => showSession(data.session)).catch(error => {
    byId('auth').hidden = false;
    tell(error.message);
  });
}

async function jpeg(file) {
  const image = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d', {alpha:false});
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) => canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('แปลงรูปเป็น JPEG ไม่สำเร็จ')), 'image/jpeg', .85
    ));
  } finally {
    image.close();
  }
}
