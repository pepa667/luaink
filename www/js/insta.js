function renderTramposGaleria() {
    // Puxa o JSON estático local atualizado pelo GitHub Actions
    fetch('./insta-links.json')
        .then(response => {
            if (!response.ok) throw new Error("JSON de links não encontrado.");
            return response.json();
        })
        .then(data => {
            const galeriaContainer = document.getElementById('tramposGaleria');
            if (!galeriaContainer) return;

            galeriaContainer.innerHTML = ''; // Limpa o container

            data.posts.forEach(post => {
                // 1. Cria a tag <a> com o link real do post
                const linkElement = document.createElement('a');
                linkElement.href = post.permalink;
                linkElement.target = '_blank';
                linkElement.id = `trampo_${post.index}`;

                // 2. Cria a div interna da foto com o background inline
                const fotoElement = document.createElement('div');
                fotoElement.className = 'trampoFoto';
                fotoElement.id = `foto_${post.index}`;
                // Injeta a imagem local salva pelo robô com cache-busting do timestamp para forçar atualização no navegador
                fotoElement.style.backgroundImage = `url('${post.localImage}?t=${new Date().getTime()}')`;
                fotoElement.innerHTML = '&nbsp;';

                // 3. Cria a div de efeito/hover com os textos originais
                const abreElement = document.createElement('div');
                abreElement.className = 'trampoAbre';

                abreElement.innerHTML = `
                    <span class="trampoVe">Veja lá!</span>
                    <img src="images/insta_ico.png" class="instaICO">
                    <span class="trampoCurte">Curte<br />e comenta também!</span>
                `;

                // 4. Monta a árvore de elementos
                linkElement.appendChild(fotoElement);
                linkElement.appendChild(abreElement);
                galeriaContainer.appendChild(linkElement);
            });
        })
        .catch(error => {
            console.error("Erro ao renderizar a galeria estática:", error);
            // Se o JSON falhar (ex: primeiro deploy), o site não quebra.
        });
}

// Inicializa a galeria assim que a página carregar
document.addEventListener('DOMContentLoaded', renderTramposGaleria);