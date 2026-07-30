require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { 
    Client, 
    GatewayIntentBits, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    StringSelectMenuBuilder, 
    EmbedBuilder, 
    ChannelType, 
    PermissionFlagsBits,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    REST,
    Routes,
    SlashCommandBuilder
} = require('discord.js');

const { joinVoiceChannel } = require('@discordjs/voice');
const { MercadoPagoConfig, Payment } = require('mercadopago');

const mpClient = new MercadoPagoConfig({ accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN });
const paymentApi = new Payment(mpClient);

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildEmojisAndStickers,
        GatewayIntentBits.GuildVoiceStates
    ] 
});
const configPath = path.join(__dirname, 'config.json');

const ID_CANAL_LOGS = '1528400599098327181';
const ID_CANAL_AVALIACOES = '1528155569603743926';
const ID_CATEGORIA_SUPORTE = '1528399631162278081';
const GUILD_ID = '1528140827321438259';

// ID do Canal de Voz onde o bot deve se conectar
const ID_CANAL_VOZ = '1531853981616308244';

function getConfig() {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

function saveConfig(data) {
    fs.writeFileSync(configPath, JSON.stringify(data, null, 2), 'utf8');
}

const ticketsData = new Map();
const selecoesAtivas = new Map();
const selecoesTemporarias = new Map();
const robloxPendingData = new Map();
const avaliacoesPendentes = new Map();
const produtoEditCache = new Map();
const categoriaEditCache = new Map();

const commands = [
    new SlashCommandBuilder()
        .setName('setup-loja')
        .setDescription('Envia o painel principal da loja'),
    new SlashCommandBuilder()
        .setName('suporte')
        .setDescription('Envia o painel de atendimento e suporte geral da loja'),
    new SlashCommandBuilder()
        .setName('set-categoria-tickets')
        .setDescription('Define a categoria onde os tickets de pedidos serão abertos')
        .addStringOption(option => 
            option.setName('id_categoria').setDescription('ID da categoria do Discord').setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName('painel-gerenciar-categorias')
        .setDescription('Painel interativo para Criar ou Editar categorias (Staff)'),
    new SlashCommandBuilder()
        .setName('remover-categoria')
        .setDescription('Remove uma categoria existente da loja')
        .addStringOption(option => 
            option.setName('categoria_id')
                  .setDescription('Selecione a categoria que deseja remover')
                  .setRequired(true)
                  .setAutocomplete(true)
        ),
    new SlashCommandBuilder()
        .setName('painel-gerenciar-produtos')
        .setDescription('Painel interativo para Criar ou Editar produtos (Staff)'),
    new SlashCommandBuilder()
        .setName('excluir-produto')
        .setDescription('Exclui um produto selecionando pelo nome')
        .addStringOption(option => 
            option.setName('produto_id')
                  .setDescription('Selecione o produto na lista')
                  .setRequired(true)
                  .setAutocomplete(true)
        ),
    new SlashCommandBuilder()
        .setName('termos-de-servico')
        .setDescription('Envia o painel de Termos de Serviço no canal atual'),
    new SlashCommandBuilder()
        .setName('catalogo')
        .setDescription('Envia o painel com o link para o catálogo de preços (Apenas Staff)'),
    new SlashCommandBuilder()
        .setName('precos')
        .setDescription('Exibe o painel fixo com a tabela de preços da loja (Apenas Staff)'),
    new SlashCommandBuilder()
        .setName('painel')
        .setDescription('Exibe um painel interativo com todos os comandos disponíveis da Staff'),
    new SlashCommandBuilder()
        .setName('roblox')
        .setDescription('Comandos relacionados ao Roblox')
        .addSubcommand(sub =>
            sub.setName('avatar')
               .setDescription('Consulta o avatar completo e informações de um usuário do Roblox')
               .addStringOption(option =>
                   option.setName('usuario')
                         .setDescription('Nome de usuário (nick) no Roblox')
                         .setRequired(true)
               )
        )
].map(command => command.toJSON());

// FUNÇÃO DA API DO ROBLOX
async function buscarPerfilRoblox(username) {
    try {
        const resUser = await fetch('https://users.roblox.com/v1/usernames/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usernames: [username], excludeBannedUsers: false })
        });
        const dataUser = await resUser.json();

        if (!dataUser.data || dataUser.data.length === 0) return null;

        const robloxUser = dataUser.data[0];

        const resAvatarFull = await fetch(`https://thumbnails.roblox.com/v1/users/avatar?userIds=${robloxUser.id}&size=720x720&format=Png&isCircular=false`);
        const dataAvatarFull = await resAvatarFull.json();

        let avatarUrl = null;
        if (dataAvatarFull.data && dataAvatarFull.data.length > 0 && dataAvatarFull.data[0].imageUrl) {
            avatarUrl = dataAvatarFull.data[0].imageUrl;
        }

        if (!avatarUrl) {
            const resAvatarBust = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${robloxUser.id}&size=420x420&format=Png&isCircular=false`);
            const dataBust = await resAvatarBust.json();
            if (dataBust.data && dataBust.data.length > 0) {
                avatarUrl = dataBust.data[0].imageUrl;
            }
        }

        return {
            id: robloxUser.id,
            name: robloxUser.name,
            displayName: robloxUser.displayName,
            profileUrl: `https://www.roblox.com/users/${robloxUser.id}/profile`,
            avatarUrl: avatarUrl || 'https://i.imgur.com/83pL60v.png'
        };
    } catch (e) {
        console.error('Erro na API do Roblox:', e);
        return null;
    }
}

function formatarEmojiDiscord(emojiStr) {
    if (!emojiStr) return null;
    if (emojiStr.includes(':')) {
        const partes = emojiStr.split(':');
        const nomeEmoji = partes[partes.length - 2];
        const idEmoji = partes[partes.length - 1].replace('>', '');
        return { name: nomeEmoji, id: idEmoji };
    }
    return emojiStr;
}

function gerarMenuCategoriasPrincipal(config) {
    const options = config.categorias.map(cat => {
        const opt = {
            label: cat.nome,
            value: cat.id,
            description: cat.descricao
        };
        if (cat.emoji) {
            opt.emoji = formatarEmojiDiscord(cat.emoji);
        }
        return opt;
    });

    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('select_categoria_loja')
            .setPlaceholder('Selecione uma categoria...')
            .addOptions(options)
    );
}

function gerarRowTermos() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setStyle(ButtonStyle.Link)
            .setLabel('📖 Termos de Serviço')
            .setURL('https://deluxostore-termos.vercel.app/')
    );
}

function montarPainelPrecos(config, indexCategoria = 0) {
    if (!config.categorias || config.categorias.length === 0) {
        return {
            embeds: [
                new EmbedBuilder()
                    .setTitle('🏷️ • Tabela de Preços')
                    .setDescription('❌ Não há categorias ou produtos cadastrados na loja no momento.')
                    .setColor('#A020F0')
            ],
            components: []
        };
    }

    if (indexCategoria < 0) indexCategoria = config.categorias.length - 1;
    if (indexCategoria >= config.categorias.length) indexCategoria = 0;

    const categoria = config.categorias[indexCategoria];
    const produtos = categoria.produtos || [];

    let descricaoProdutos = '';
    if (produtos.length === 0) {
        descricaoProdutos = '_Nenhum produto cadastrado nesta categoria._';
    } else {
        descricaoProdutos = produtos.map((p) => {
            const emojiProd = p.emoji ? `${p.emoji} ` : '';
            return `> ${emojiProd}**${p.nome}**\n> Preço: **R$ ${p.preco.toFixed(2)}**`;
        }).join('\n\n');
    }

    const embedPrecos = new EmbedBuilder()
        .setDescription(
            `# ${categoria.emoji ? categoria.emoji + ' ' : ''}${categoria.nome}\n` +
            `---------------------------------------------------------\n\n` +
            `${descricaoProdutos}`
        )
        .setColor('#A020F0')
        .setFooter({ text: 'Deluxo Store © Todos os direitos reservados.' })
        .setTimestamp();

    const rowBotoesNavegacao = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`btn_preco_ant_${indexCategoria}`)
            .setEmoji('◀️')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`btn_preco_prox_${indexCategoria}`)
            .setEmoji('▶️')
            .setStyle(ButtonStyle.Primary)
    );

    return {
        embeds: [embedPrecos],
        components: [rowBotoesNavegacao],
        indexAtual: indexCategoria
    };
}

function montarPainelPrivado(config, catId) {
    const categoria = config.categorias.find(c => c.id === catId);
    if (!categoria || !categoria.produtos || categoria.produtos.length === 0) return null;

    const embed = new EmbedBuilder()
        .setImage('https://media.discordapp.net/attachments/1528400599098327181/1529439687196938350/dawwddawawdawdd.png?ex=6a6a82f5&is=6a693175&hm=b6600c975481b45d2feb0fa24f2d4eda9d38e977ffa455e80817c902acd35d50&=&format=webp&quality=lossless&width=1024&height=176')
        .setColor('#A020F0');

    const options = categoria.produtos.map(p => ({
        label: p.nome.slice(0, 100),
        value: p.id,
        description: `Preço: R$ ${p.preco.toFixed(2)}`,
        emoji: p.emoji ? formatarEmojiDiscord(p.emoji) : undefined
    }));

    const menu = new StringSelectMenuBuilder()
        .setCustomId(`select_subprod_${catId}`)
        .setPlaceholder('Escolha os produtos...')
        .setMinValues(1)
        .setMaxValues(Math.min(options.length, 25))
        .addOptions(options);

    const rowMenu = new ActionRowBuilder().addComponents(menu);

    const rowBotoes = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`btn_confirmar_selecao_${catId}`)
            .setLabel('Confirmar Seleção')
            .setStyle(ButtonStyle.Success)
    );

    const categoriasOptions = config.categorias.map(cat => ({
        label: cat.nome,
        value: cat.id,
        description: cat.descricao ? cat.descricao.slice(0, 50) : '',
        emoji: cat.emoji ? formatarEmojiDiscord(cat.emoji) : undefined,
        default: cat.id === catId
    }));

    const menuCategorias = new StringSelectMenuBuilder()
        .setCustomId('select_categoria_privada')
        .setPlaceholder('Mudar de categoria...')
        .addOptions(categoriasOptions);

    const rowCategorias = new ActionRowBuilder().addComponents(menuCategorias);

    return {
        embeds: [embed],
        components: [rowCategorias, rowMenu, rowBotoes]
    };
}

client.once('ready', async () => {
    console.log(`🤖 Bot da Loja Online como ${client.user.tag}`);

    // CONECTA AUTOMATICAMENTE AO CANAL DE VOZ DEFINIDO EM ID_CANAL_VOZ
    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        if (guild) {
            const voiceChannel = await guild.channels.fetch(ID_CANAL_VOZ).catch(() => null);
            if (voiceChannel && voiceChannel.isVoiceBased()) {
                joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: guild.id,
                    adapterCreator: guild.voiceAdapterCreator,
                    selfDeaf: true
                });
                console.log(`🔊 Bot conectado com sucesso ao canal de voz: ${voiceChannel.name}`);
            } else {
                console.log('⚠️ Canal de voz não encontrado ou ID inválido.');
            }
        }
    } catch (err) {
        console.error('Erro ao conectar ao canal de voz:', err);
    }

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        console.log('🔄 Atualizando comandos Slash (/) instantaneamente no servidor...');
        await rest.put(
            Routes.applicationGuildCommands(client.user.id, GUILD_ID),
            { body: commands },
        );
        console.log('✅ Comandos Slash registrados com sucesso no servidor!');
    } catch (error) {
        console.error('Erro ao registrar comandos:', error);
    }
});

client.on('interactionCreate', async interaction => {
    if (interaction.isStringSelectMenu()) {
        const valorSelecionado = interaction.values[0];

        if (valorSelecionado === 'pagina_2') {
            const partes = interaction.customId.split('_');
            const itemIdAntigo = partes[partes.length - 1];
            const prefixo = interaction.customId.replace(`_${itemIdAntigo}`, '');
            const novoMenu = await gerarMenuEmojis(interaction.guild, prefixo, itemIdAntigo, 2);
            return await interaction.update({ components: [novoMenu] });
        }
        
        if (valorSelecionado === 'pagina_1') {
            const partes = interaction.customId.split('_');
            const itemIdAntigo = partes[partes.length - 1];
            const prefixo = interaction.customId.replace(`_${itemIdAntigo}`, '');
            const novoMenu = await gerarMenuEmojis(interaction.guild, prefixo, itemIdAntigo, 1);
            return await interaction.update({ components: [novoMenu] });
        }
    }

    if (interaction.isAutocomplete()) {
        const config = getConfig();
        const focusedOption = interaction.options.getFocused(true);
        const focusedValue = focusedOption.value.toLowerCase();
        
        let choices = [];

        if (focusedOption.name === 'produto_id') {
            for (const cat of config.categorias) {
                if (!cat.produtos) continue;
                for (const prod of cat.produtos) {
                    choices.push({
                        name: `[${cat.nome}] ${prod.nome} (R$ ${prod.preco.toFixed(2)})`,
                        value: prod.id
                    });
                }
            }
        } else if (focusedOption.name === 'categoria_id') {
            for (const cat of config.categorias) {
                choices.push({
                    name: `${cat.nome} (${cat.produtos ? cat.produtos.length : 0} produtos) - Mín: R$ ${(cat.valorMinimo || 0).toFixed(2)}`,
                    value: cat.id
                });
            }
        }

        const filtered = choices.filter(choice => choice.name.toLowerCase().includes(focusedValue)).slice(0, 25);
        await interaction.respond(filtered).catch(() => {});
        return;
    }

    const config = getConfig();
    const ID_STAFF = config.cargoStaffId;

    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'roblox') {
            const CANAL_PERMITIDO_AVATAR = '1529944595339935804';

            if (interaction.channelId !== CANAL_PERMITIDO_AVATAR) {
                return interaction.reply({ 
                    content: `❌ Este comando só pode ser utilizado no canal <#${CANAL_PERMITIDO_AVATAR}>.`, 
                    ephemeral: true 
                });
            }

            const subcommand = interaction.options.getSubcommand();
            if (subcommand === 'avatar') {
                await interaction.deferReply();
                const username = interaction.options.getString('usuario').trim();
                
                const perfil = await buscarPerfilRoblox(username);

                if (!perfil) {
                    return interaction.editReply({ 
                        content: `❌ Não foi possível encontrar nenhum usuário no Roblox com o nick **"${username}"**.`
                    });
                }

                const embedAvatar = new EmbedBuilder()
                    .setTitle(`<:roblox:1531247150762033297> Perfil Roblox: ${perfil.displayName}`)
                    .setDescription(
                        `• **Nome de usuário (@):** ${perfil.name}\n` +
                        `• **ID do Roblox:** \`${perfil.id}\``
                    )
                    .setColor('#A020F0')
                    .setTimestamp();

                if (perfil.avatarUrl) {
                    embedAvatar.setImage(perfil.avatarUrl);
                }

                const rowAvatarButtons = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setStyle(ButtonStyle.Link)
                        .setLabel('Visitar Perfil')
                        .setURL(perfil.profileUrl)
                        .setEmoji('🌐'),
                    ...(perfil.avatarUrl ? [
                        new ButtonBuilder()
                            .setStyle(ButtonStyle.Link)
                            .setLabel('Baixar Imagem')
                            .setURL(perfil.avatarUrl)
                            .setEmoji('📥')
                    ] : [])
                );

                return interaction.editReply({ embeds: [embedAvatar], components: [rowAvatarButtons] });
            }
        }

        if (interaction.commandName === 'precos') {
            const temCargoStaff = interaction.member.roles.cache.has(ID_STAFF);
            if (!temCargoStaff) {
                return interaction.reply({ content: '❌ Você não tem permissão para usar este comando.', ephemeral: true });
            }

            const ID_CANAL_PRECOS_FIXO = '1529454088306036756';
            const canalAlvo = interaction.guild.channels.cache.get(ID_CANAL_PRECOS_FIXO);

            if (!canalAlvo) {
                return interaction.reply({ content: `❌ O canal de preços configurado (<#${ID_CANAL_PRECOS_FIXO}>) não foi encontrado no servidor.`, ephemeral: true });
            }

            const embedPainelFixo = new EmbedBuilder()
                .setTitle('Tabela de Preços - DELUXO STORE!')
                .setDescription('Clique no botão abaixo para ver os preços de nossos produtos na loja.')
                .setImage('https://media.discordapp.net/attachments/1528400599098327181/1529439687196938350/dawwddawawdawdd.png?ex=6a6a82f5&is=6a693175&hm=b6600c975481b45d2feb0fa24f2d4eda9d38e977ffa455e80817c902acd35d50&=&format=webp&quality=lossless&width=1024&height=176')
                .setColor('#A020F0');

            const rowBotaoPrecos = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('btn_abrir_painel_precos_privado')
                    .setLabel('Ver Painel de Preços')
                    .setEmoji('💹')
                    .setStyle(ButtonStyle.Primary)
            );

            await canalAlvo.send({
                embeds: [embedPainelFixo],
                components: [rowBotaoPrecos]
            });

            return interaction.reply({
                content: `✅ Painel de preços enviado com sucesso no canal <#${ID_CANAL_PRECOS_FIXO}>!`,
                ephemeral: true
            });
        }

        const temCargoStaff = interaction.member.roles.cache.has(ID_STAFF);

        if (!temCargoStaff) {
            return interaction.reply({ content: '❌ Você não tem permissão para usar este comando.', ephemeral: true });
        }

        if (interaction.commandName === 'setup-loja') {
            const embedLoja = new EmbedBuilder()
                .setTitle(config.titulo)
                .setDescription(config.descricao)
                .setImage('https://media.discordapp.net/attachments/1528400599098327181/1529439687737999520/dwadawwdadaw.png?ex=6a61f135&is=6a609fb5&hm=4e6761d032ade919ae90b7de4fd6c671908730f62fa19136a607d74fc5fc27f3&=&format=webp&quality=lossless&width=928&height=522')
                .setColor('#A020F0')
                .setFooter({ text: config.rodape });

            const menuCategorias = gerarMenuCategoriasPrincipal(config);
            const rowTermos = gerarRowTermos();

            const msgEnviada = await interaction.channel.send({ 
                embeds: [embedLoja], 
                components: [menuCategorias, rowTermos] 
            });

            config.painelLojaChannelId = interaction.channel.id;
            config.painelLojaMessageId = msgEnviada.id;
            saveConfig(config);

            await interaction.reply({ content: '✅ Painel enviado e vinculado com sucesso!', ephemeral: true });
        }

        if (interaction.commandName === 'suporte') {
            const embedSuporte = new EmbedBuilder()
                .setTitle('🎫 • Central de Suporte e Dúvidas')
                .setDescription(
                    'Precisa de ajuda, tem alguma dúvida sobre a loja ou precisa falar com a nossa equipe?\n\n' +
                    'Clique no botão abaixo para **abrir um ticket de suporte exclusivo**. Um canal privado será criado para conversarmos com total segurança e privacidade.\n\n' +
                    '⚠️ **Aviso:** Este canal de atendimento é **exclusivamente para dúvidas, suporte geral e orientações** sobre a loja. Não utilize para realizar pedidos de compras.'
                )
                .setColor('#A020F0')
                .setImage('https://media.discordapp.net/attachments/1528400599098327181/1529462641259446413/dwadawwdadaw.png') 
                .setFooter({ text: 'Deluxo Store © Todos os direitos reservados.' });

            const rowSuporte = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('btn_abrir_suporte_ticket')
                    .setLabel('Abrir Ticket de Suporte')
                    .setEmoji('🎫')
                    .setStyle(ButtonStyle.Primary)
            );

            await interaction.channel.send({
                embeds: [embedSuporte],
                components: [rowSuporte]
            });

            await interaction.reply({ content: '✅ Painel de Suporte enviado com sucesso!', ephemeral: true });
        }

        if (interaction.commandName === 'set-categoria-tickets') {
            config.categoriaTicketsId = interaction.options.getString('id_categoria');
            saveConfig(config);
            await interaction.reply({ content: `✅ Categoria de tickets atualizada!`, ephemeral: true });
        }

        if (interaction.commandName === 'painel-gerenciar-categorias') {
            const embedGerenciarCat = new EmbedBuilder()
                .setTitle('📁 • Painel de Gerenciamento de Categorias')
                .setDescription('Escolha abaixo se deseja **Criar** uma nova categoria ou **Editar** uma categoria existente.')
                .setColor('#A020F0');

            const rowBotoesCat = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('btn_painel_criar_categoria')
                    .setLabel('Criar Categoria')
                    .setEmoji('➕')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('btn_painel_editar_categoria')
                    .setLabel('Editar Categoria')
                    .setEmoji('✏️')
                    .setStyle(ButtonStyle.Primary)
            );

            return interaction.reply({
                embeds: [embedGerenciarCat],
                components: [rowBotoesCat],
                ephemeral: true
            });
        }

        if (interaction.commandName === 'remover-categoria') {
            const categoriaId = interaction.options.getString('categoria_id');
            if (!config.categorias) config.categorias = [];

            const index = config.categorias.findIndex(c => c.id === categoriaId);
            if (index === -1) {
                return interaction.reply({ content: `❌ A categoria selecionada não foi encontrada.`, ephemeral: true });
            }

            const nomeRemovido = config.categorias[index].nome;
            config.categorias.splice(index, 1);
            saveConfig(config);

            await interaction.reply({ content: `🗑️ Categoria **${nomeRemovido}** removida com sucesso da loja!`, ephemeral: true });
        }

        if (interaction.commandName === 'painel-gerenciar-produtos') {
            const embedGerenciar = new EmbedBuilder()
                .setTitle('🛠️ • Painel de Gerenciamento de Produtos')
                .setDescription('Escolha abaixo se deseja **Criar** um novo produto ou **Editar** um produto existente.')
                .setColor('#A020F0');

            const rowBotoesGerenciar = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('btn_painel_criar_produto')
                    .setLabel('Criar Produto')
                    .setEmoji('➕')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('btn_painel_editar_produto')
                    .setLabel('Editar Produto')
                    .setEmoji('✏️')
                    .setStyle(ButtonStyle.Primary)
            );

            return interaction.reply({
                embeds: [embedGerenciar],
                components: [rowBotoesGerenciar],
                ephemeral: true
            });
        }

        if (interaction.commandName === 'excluir-produto') {
            const produtoId = interaction.options.getString('produto_id');
            let encontrado = false;
            let nomeProdutoRemovido = '';

            for (const cat of config.categorias) {
                if (!cat.produtos) continue;
                const index = cat.produtos.findIndex(p => p.id === produtoId);
                if (index !== -1) {
                    nomeProdutoRemovido = cat.produtos[index].nome;
                    cat.produtos.splice(index, 1);
                    encontrado = true;
                    break;
                }
            }

            if (!encontrado) {
                return interaction.reply({ content: `❌ O produto selecionado não foi encontrado.`, ephemeral: true });
            }

            saveConfig(config);
            await interaction.reply({ content: `🗑️ Produto **${nomeProdutoRemovido}** excluído com sucesso!`, ephemeral: true });
        }

        if (interaction.commandName === 'termos-de-servico') {
            const embedTermos = new EmbedBuilder()
                .setTitle('📖 • Termos de Serviço')
                .setDescription(
                    'Bem-vindo aos **Termos de Serviço** da **DELUXO STORE**!\n\n' +
                    'Por favor, acesse o documento completo no botão abaixo para conferir nossas políticas de entrega, reembolsos e regras da loja.\n\n' +
                    '⚠️ **Aviso Importante:** Ao realizar qualquer compra ou pedido em nossa loja, você concorda **automaticamente** com todos os termos estabelecidos.'
                )
                .setColor('#A020F0')
                .setTimestamp();

            const rowTermos = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setStyle(ButtonStyle.Link)
                    .setLabel('Acessar Termos de Serviço')
                    .setEmoji('📖')
                    .setURL('https://deluxostore-termos.vercel.app/')
            );

            await interaction.channel.send({
                embeds: [embedTermos],
                components: [rowTermos]
            });

            await interaction.reply({ content: '✅ Mensagem de Termos de Serviço enviada com sucesso!', ephemeral: true });
        }

        if (interaction.commandName === 'catalogo') {
            const embedPrecos = new EmbedBuilder()
                .setTitle('🏷️ • Catálogo de Preços')
                .setDescription(
                    'Bem-vindo ao **Catálogo de Preços** da **DELUXO STORE**!\n\n' +
                    'Clique no botão abaixo para acessar nosso site oficial e conferir todos os preços atualizados dos nossos produtos e serviços.\n\n' +
                    '💡 **Dica:** Nosso catálogo web é atualizado em tempo real para garantir que você sempre veja os valores corretos.'
                )
                .setColor('#A020F0')
                .setTimestamp();

            const rowPrecos = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setStyle(ButtonStyle.Link)
                    .setLabel('Acessar Catálogo de Preços')
                    .setEmoji('🏷️')
                    .setURL('https://catalogo-deluxostore.vercel.app/')
            );

            await interaction.channel.send({
                embeds: [embedPrecos],
                components: [rowPrecos]
            });

            await interaction.reply({ content: '✅ Mensagem do Catálogo de Preços enviada com sucesso!', ephemeral: true });
        }

        if (interaction.commandName === 'painel') {
            const embedPainelComandos = new EmbedBuilder()
                .setTitle('📋 • Painel de Comandos da Staff')
                .setDescription('Abaixo estão listados todos os comandos administrativos disponíveis no bot e suas respectivas funções:')
                .setColor('#A020F0')
                .addFields(
                    { name: '🛒 `/setup-loja`', value: 'Envia o painel principal interativo da loja no canal atual.' },
                    { name: '🎫 `/suporte`', value: 'Envia o painel de atendimento e suporte geral para os membros.' },
                    { name: '⚙️ `/set-categoria-tickets`', value: 'Define a categoria do Discord onde os tickets de pedidos serão abertos.' },
                    { name: '📁 `/painel-gerenciar-categorias`', value: 'Painel interativo para Criar ou Editar categorias (Nome, Descrição, Mínimo, Emoji).' },
                    { name: '🗑️ `/remover-categoria`', value: 'Remove uma categoria existente da loja através de autocompletar.' },
                    { name: '🛠️ `/painel-gerenciar-produtos`', value: 'Abre o painel interativo para Criar ou Editar produtos e seus emojis.' },
                    { name: '🗑️ `/excluir-produto`', value: 'Exclui um produto específico da loja usando autocompletar.' },
                    { name: '📖 `/termos-de-servico`', value: 'Envia o painel oficial com os Termos de Serviço no canal atual.' },
                    { name: '🏷️ `/catalogo`', value: 'Envia o painel com o link de acesso ao catálogo de preços.' },
                    { name: '🏷️ `/precos`', value: 'Exibe o painel fixo com o botão para abrir a tabela interativa de preços.' },
                    { name: '📋 `/painel`', value: 'Exibe esta mensagem de ajuda com todos os comandos da staff.' },
                    { name: '🎮 `/roblox avatar`', value: 'Consulta o avatar completo e informações de um usuário do Roblox.' }
                )
                .setTimestamp();

            await interaction.reply({ embeds: [embedPainelComandos], ephemeral: true });
        }
    }

    if (interaction.isButton() && interaction.customId === 'btn_abrir_painel_precos_privado') {
        const painel = montarPainelPrecos(config, 0);
        return interaction.reply({
            embeds: painel.embeds,
            components: painel.components,
            ephemeral: true
        });
    }

    if (interaction.isButton() && (interaction.customId.startsWith('btn_preco_ant_') || interaction.customId.startsWith('btn_preco_prox_'))) {
        const partes = interaction.customId.split('_');
        const currentIndex = parseInt(partes[partes.length - 1]);
        const direcao = interaction.customId.includes('_ant_') ? -1 : 1;

        const novoIndex = currentIndex + direcao;
        const painelAtualizado = montarPainelPrecos(config, novoIndex);

        return await interaction.update({
            embeds: painelAtualizado.embeds,
            components: painelAtualizado.components
        });
    }

    if (interaction.isButton() && interaction.customId === 'btn_painel_criar_categoria') {
        const modalCriarCat = new ModalBuilder()
            .setCustomId('modal_exec_criar_categoria')
            .setTitle('Criar Nova Categoria');

        const inputNome = new TextInputBuilder()
            .setCustomId('input_cat_nome')
            .setLabel('Nome da Categoria')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const inputDesc = new TextInputBuilder()
            .setCustomId('input_cat_desc')
            .setLabel('Descrição da Categoria')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const inputMinimo = new TextInputBuilder()
            .setCustomId('input_cat_minimo')
            .setLabel('Valor Mínimo de Compra (ex: 5.00)')
            .setStyle(TextInputStyle.Short)
            .setValue('0.00')
            .setRequired(true);

        modalCriarCat.addComponents(
            new ActionRowBuilder().addComponents(inputNome),
            new ActionRowBuilder().addComponents(inputDesc),
            new ActionRowBuilder().addComponents(inputMinimo)
        );

        return interaction.showModal(modalCriarCat);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'modal_exec_criar_categoria') {
        await interaction.deferReply({ ephemeral: true });

        const nome = interaction.fields.getTextInputValue('input_cat_nome');
        const descricao = interaction.fields.getTextInputValue('input_cat_desc');
        const valorMinimoStr = interaction.fields.getTextInputValue('input_cat_minimo').replace(',', '.');
        const valorMinimo = parseFloat(valorMinimoStr);

        if (isNaN(valorMinimo) || valorMinimo < 0) {
            return interaction.editReply({ content: '❌ Valor mínimo inválido. Digite um número válido (ex: 5.00).' });
        }

        const categoriaId = 'cat_' + Date.now();
        categoriaEditCache.set(interaction.user.id, {
            categoriaId,
            nome,
            descricao,
            valorMinimo,
            acao: 'criar'
        });

        const menuEmojis = await gerarMenuEmojis(interaction.guild, 'select_emoji_nova_categoria', categoriaId, 1);

        return interaction.editReply({
            content: `✅ Informações salvas! Agora, **escolha o emoji visual** para a categoria **${nome}**:`,
            components: [menuEmojis]
        });
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('select_emoji_nova_categoria_')) {
        const valorSelecionado = interaction.values[0];
        if (valorSelecionado === 'pagina_2' || valorSelecionado === 'pagina_1') return;

        const partesId = interaction.customId.split('_');
        const catId = partesId[partesId.length - 1];
        const dadosCache = categoriaEditCache.get(interaction.user.id);

        if (!dadosCache || dadosCache.categoriaId !== catId) {
            return interaction.update({ content: '❌ Sessão expirada.', components: [] });
        }

        let emojiFinal = null;

        if (valorSelecionado !== 'sem_emoji') {
            const emojiId = valorSelecionado.replace('custom_', '');
            const emojiObj = interaction.guild.emojis.cache.get(emojiId);
            if (emojiObj) {
                emojiFinal = `<:${emojiObj.name}:${emojiObj.id}>`;
            }
        }

        if (!config.categorias) config.categorias = [];

        config.categorias.push({
            id: catId,
            nome: dadosCache.nome,
            descricao: dadosCache.descricao,
            valorMinimo: dadosCache.valorMinimo || 0,
            emoji: emojiFinal,
            produtos: []
        });

        saveConfig(config);
        categoriaEditCache.delete(interaction.user.id);

        return interaction.update({
            content: `✅ Categoria **${dadosCache.nome}** criada com sucesso (Mín: R$ ${(dadosCache.valorMinimo || 0).toFixed(2)}) com o emoji ${emojiFinal || 'Nenhum'}!`,
            components: []
        });
    }

    if (interaction.isButton() && interaction.customId === 'btn_painel_editar_categoria') {
        if (!config.categorias || config.categorias.length === 0) {
            return interaction.reply({ content: '❌ Não há categorias cadastradas.', ephemeral: true });
        }

        const menuCategoriasEditar = new StringSelectMenuBuilder()
            .setCustomId('select_categoria_para_editar_menu')
            .setPlaceholder('Selecione a categoria que deseja editar...')
            .addOptions(config.categorias.map(cat => ({
                label: cat.nome,
                value: cat.id,
                description: `Mín: R$ ${(cat.valorMinimo || 0).toFixed(2)} - ${cat.descricao ? cat.descricao.slice(0, 50) : ''}`,
                emoji: cat.emoji ? formatarEmojiDiscord(cat.emoji) : undefined
            })));

        return interaction.reply({
            content: '📂 Selecione abaixo a categoria que deseja editar:',
            components: [new ActionRowBuilder().addComponents(menuCategoriasEditar)],
            ephemeral: true
        });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'select_categoria_para_editar_menu') {
        const catId = interaction.values[0];
        const categoria = config.categorias.find(c => c.id === catId);

        if (!categoria) {
            return interaction.update({ content: `❌ Categoria não encontrada.`, components: [] });
        }

        categoriaEditCache.set(interaction.user.id, {
            categoriaId: categoria.id,
            acao: 'editar'
        });

        const modalEditarCat = new ModalBuilder()
            .setCustomId('modal_exec_editar_categoria')
            .setTitle(`Editar Categoria: ${categoria.nome}`);

        const inputNome = new TextInputBuilder()
            .setCustomId('input_cat_novo_nome')
            .setLabel('Novo Nome')
            .setValue(categoria.nome)
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const inputDesc = new TextInputBuilder()
            .setCustomId('input_cat_nova_desc')
            .setLabel('Nova Descrição')
            .setValue(categoria.descricao || '')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const inputMinimo = new TextInputBuilder()
            .setCustomId('input_cat_novo_minimo')
            .setLabel('Valor Mínimo de Compra (ex: 5.00)')
            .setValue(categoria.valorMinimo ? categoria.valorMinimo.toString() : '0.00')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        modalEditarCat.addComponents(
            new ActionRowBuilder().addComponents(inputNome),
            new ActionRowBuilder().addComponents(inputDesc),
            new ActionRowBuilder().addComponents(inputMinimo)
        );

        return interaction.showModal(modalEditarCat);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'modal_exec_editar_categoria') {
        await interaction.deferReply({ ephemeral: true });

        const dadosCache = categoriaEditCache.get(interaction.user.id);
        if (!dadosCache) {
            return interaction.editReply({ content: '❌ Sessão expirada.' });
        }

        const novoNome = interaction.fields.getTextInputValue('input_cat_novo_nome');
        const novaDesc = interaction.fields.getTextInputValue('input_cat_nova_desc');
        const novoMinimoStr = interaction.fields.getTextInputValue('input_cat_novo_minimo').replace(',', '.');
        const novoMinimo = parseFloat(novoMinimoStr);

        if (isNaN(novoMinimo) || novoMinimo < 0) {
            return interaction.editReply({ content: '❌ Valor mínimo inválido. Digite um número válido (ex: 5.00).' });
        }

        const categoria = config.categorias.find(c => c.id === dadosCache.categoriaId);
        if (!categoria) {
            return interaction.editReply({ content: '❌ Categoria não encontrada.' });
        }

        categoria.nome = novoNome;
        categoria.descricao = novaDesc;
        categoria.valorMinimo = novoMinimo;
        saveConfig(config);

        const menuEmojis = await gerarMenuEmojis(interaction.guild, 'select_emoji_editar_categoria', categoria.id, 1);

        return interaction.editReply({
            content: `✅ Informações atualizadas! Agora, **escolha o novo emoji visual** para a categoria **${novoNome}**:`,
            components: [menuEmojis]
        });
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('select_emoji_editar_categoria_')) {
        const valorSelecionado = interaction.values[0];
        if (valorSelecionado === 'pagina_2' || valorSelecionado === 'pagina_1') return;

        const partesId = interaction.customId.split('_');
        const catId = partesId[partesId.length - 1];

        const dadosCache = categoriaEditCache.get(interaction.user.id);
        const targetCatId = (dadosCache && dadosCache.categoriaId) ? dadosCache.categoriaId : catId;

        const categoria = config.categorias.find(c => c.id === targetCatId);
        if (!categoria) {
            return interaction.update({ content: '❌ Categoria não encontrada.', components: [] });
        }

        if (valorSelecionado === 'sem_emoji') {
            categoria.emoji = null;
        } else {
            const emojiId = valorSelecionado.replace('custom_', '');
            const emojiObj = interaction.guild.emojis.cache.get(emojiId);
            if (emojiObj) {
                categoria.emoji = `<:${emojiObj.name}:${emojiObj.id}>`;
            }
        }

        saveConfig(config);
        categoriaEditCache.delete(interaction.user.id);

        return interaction.update({
            content: `✅ Categoria **${categoria.nome}** atualizada com sucesso (Mín: R$ ${(categoria.valorMinimo || 0).toFixed(2)}) com el emoji ${categoria.emoji || 'Nenhum'}!`,
            components: []
        });
    }

    if (interaction.isButton() && interaction.customId === 'btn_painel_criar_produto') {
        if (!config.categorias || config.categorias.length === 0) {
            return interaction.reply({ content: '❌ Você precisa criar pelo menos uma categoria primeiro usando `/painel-gerenciar-categorias`.', ephemeral: true });
        }

        const menuCategoriasCriar = new StringSelectMenuBuilder()
            .setCustomId('select_categoria_para_criar_produto')
            .setPlaceholder('Selecione a categoria onde deseja criar o produto...')
            .addOptions(config.categorias.map(cat => ({
                label: cat.nome,
                value: cat.id,
                description: cat.descricao ? cat.descricao.slice(0, 100) : 'Sem descrição',
                emoji: cat.emoji ? formatarEmojiDiscord(cat.emoji) : undefined
            })));

        return interaction.reply({
            content: '📂 Selecione abaixo a categoria na qual deseja adicionar o novo produto:',
            components: [new ActionRowBuilder().addComponents(menuCategoriasCriar)],
            ephemeral: true
        });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'select_categoria_para_criar_produto') {
        const catId = interaction.values[0];
        produtoEditCache.set(interaction.user.id, { catId: catId, acao: 'criar' });

        const modalCriar = new ModalBuilder()
            .setCustomId('modal_exec_criar_produto')
            .setTitle('Criar Novo Produto');

        const inputNome = new TextInputBuilder()
            .setCustomId('input_prod_nome')
            .setLabel('Nome do Produto')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const inputPreco = new TextInputBuilder()
            .setCustomId('input_prod_preco')
            .setLabel('Preço (ex: 0.45 ou 10.50)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        modalCriar.addComponents(
            new ActionRowBuilder().addComponents(inputNome),
            new ActionRowBuilder().addComponents(inputPreco)
        );

        return interaction.showModal(modalCriar);
    }

    if (interaction.isButton() && interaction.customId === 'btn_painel_editar_produto') {
        if (!config.categorias || config.categorias.length === 0) {
            return interaction.reply({ content: '❌ Não há categorias cadastradas.', ephemeral: true });
        }

        const menuCategoriasEditar = new StringSelectMenuBuilder()
            .setCustomId('select_categoria_para_editar_produto')
            .setPlaceholder('Selecione a categoria do produto...')
            .addOptions(config.categorias.map(cat => ({
                label: cat.nome,
                value: cat.id,
                description: cat.descricao ? cat.descricao.slice(0, 100) : 'Sem descrição',
                emoji: cat.emoji ? formatarEmojiDiscord(cat.emoji) : undefined
            })));

        return interaction.reply({
            content: '📂 Selecione abaixo a categoria do produto que deseja editar:',
            components: [new ActionRowBuilder().addComponents(menuCategoriasEditar)],
            ephemeral: true
        });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'select_categoria_para_editar_produto') {
        const catId = interaction.values[0];
        const categoria = config.categorias.find(c => c.id === catId);

        if (!categoria || !categoria.produtos || categoria.produtos.length === 0) {
            return interaction.update({ content: `❌ Não há produtos cadastrados na categoria **${categoria ? categoria.nome : ''}**.`, components: [] });
        }

        const optionsProd = categoria.produtos.map(p => ({
            label: p.nome.slice(0, 100),
            value: p.id,
            description: `Preço: R$ ${p.preco.toFixed(2)}`,
            emoji: p.emoji ? formatarEmojiDiscord(p.emoji) : undefined
        }));

        const menuProdutos = new StringSelectMenuBuilder()
            .setCustomId('select_produto_para_editar')
            .setPlaceholder(`Selecione os itens em ${categoria.nome}...`)
            .addOptions(optionsProd.slice(0, 25));

        return interaction.update({
            content: `✏️ Categoria: **${categoria.nome}**. Selecione abaixo o produto que deseja editar:`,
            components: [new ActionRowBuilder().addComponents(menuProdutos)]
        });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'select_produto_para_editar') {
        const produtoId = interaction.values[0];
        
        let produtoAlvo = null;
        let categoriaAtualProd = null;
        for (const cat of config.categorias) {
            if (!cat.produtos) continue;
            const p = cat.produtos.find(prod => prod.id === produtoId);
            if (p) { 
                produtoAlvo = p; 
                categoriaAtualProd = cat;
                break; 
            }
        }

        if (!produtoAlvo) {
            return interaction.update({ content: `❌ Erro: O produto selecionado não foi encontrado.`, components: [] });
        }

        produtoEditCache.set(interaction.user.id, { produtoId: produtoId, catId: categoriaAtualProd.id, acao: 'editar' });

        const modalEditar = new ModalBuilder()
            .setCustomId('modal_exec_editar_produto')
            .setTitle('Editar Produto');

        const inputNome = new TextInputBuilder()
            .setCustomId('input_novo_nome')
            .setLabel('Novo Nome (opcional)')
            .setValue(produtoAlvo ? produtoAlvo.nome : '')
            .setStyle(TextInputStyle.Short)
            .setRequired(false);

        const inputPreco = new TextInputBuilder()
            .setCustomId('input_novo_preco')
            .setLabel('Novo Preço (opcional, ex: 10.50)')
            .setValue(produtoAlvo ? produtoAlvo.preco.toString() : '')
            .setStyle(TextInputStyle.Short)
            .setRequired(false);

        modalEditar.addComponents(
            new ActionRowBuilder().addComponents(inputNome),
            new ActionRowBuilder().addComponents(inputPreco)
        );

        return interaction.showModal(modalEditar);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'modal_exec_criar_produto') {
        await interaction.deferReply({ ephemeral: true });

        const dadosCache = produtoEditCache.get(interaction.user.id) || {};
        const catId = dadosCache.catId;
        const nome = interaction.fields.getTextInputValue('input_prod_nome');
        const precoTexto = interaction.fields.getTextInputValue('input_prod_preco').replace(',', '.');
        const preco = parseFloat(precoTexto);

        if (isNaN(preco) || preco <= 0) {
            return interaction.editReply({ content: `❌ Preço inválido. Digite um valor válido (ex: 0.45 ou 10.50).` });
        }

        const categoria = config.categorias.find(c => c.id === catId);
        if (!categoria) {
            return interaction.editReply({ content: `❌ Categoria não encontrada.` });
        }

        if (!categoria.produtos) categoria.produtos = [];

        const produtoId = 'prod_' + Date.now();
        
        produtoEditCache.set(interaction.user.id, { catId, produtoId, nome, preco, acao: 'salvar_novo' });

        const menuEmojis = await gerarMenuEmojis(interaction.guild, 'select_emoji_novo_produto', produtoId, 1);

        return interaction.editReply({
            content: `✅ Produto **${nome}** configurado! Agora, **escolha abaixo o emoji visual** que ele terá no menu:`,
            components: [menuEmojis]
        });
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('select_emoji_novo_produto_')) {
        const valorSelecionado = interaction.values[0];
        if (valorSelecionado === 'pagina_2' || valorSelecionado === 'pagina_1') return;

        const partesId = interaction.customId.split('_');
        const produtoId = partesId[partesId.length - 1];
        let dadosCache = produtoEditCache.get(interaction.user.id);

        if (!dadosCache) {
            return interaction.update({ content: '❌ Sessão expirada ou dados não encontrados.', components: [] });
        }

        let emojiFinal = null;

        if (valorSelecionado !== 'sem_emoji') {
            const emojiId = valorSelecionado.replace('custom_', '');
            const emojiObj = interaction.guild.emojis.cache.get(emojiId);
            if (emojiObj) {
                emojiFinal = `<:${emojiObj.name}:${emojiObj.id}>`;
            }
        }

        const categoria = config.categorias.find(c => c.id === dadosCache.catId);
        if (!categoria) {
            return interaction.update({ content: '❌ Categoria não encontrada.', components: [] });
        }

        if (!categoria.produtos) categoria.produtos = [];

        categoria.produtos.push({
            id: dadosCache.produtoId || produtoId,
            nome: dadosCache.nome,
            preco: dadosCache.preco,
            emoji: emojiFinal
        });

        saveConfig(config);
        produtoEditCache.delete(interaction.user.id);

        return interaction.update({
            content: `✅ Produto **${dadosCache.nome}** criado com sucesso na categoria **${categoria.nome}** por **R$ ${dadosCache.preco.toFixed(2)}** ${emojiFinal || ''}!`,
            components: []
        });
    }

    if (interaction.isModalSubmit() && interaction.customId === 'modal_exec_editar_produto') {
        await interaction.deferReply({ ephemeral: true });

        const dadosCache = produtoEditCache.get(interaction.user.id) || {};
        const produtoId = dadosCache.produtoId;
        const novoNome = interaction.fields.getTextInputValue('input_novo_nome');
        const novoPrecoStr = interaction.fields.getTextInputValue('input_novo_preco');

        let produtoEncontrado = null;

        for (const cat of config.categorias) {
            if (!cat.produtos) continue;
            const index = cat.produtos.findIndex(p => p.id === produtoId);
            if (index !== -1) {
                produtoEncontrado = cat.produtos[index];
                break;
            }
        }

        if (!produtoEncontrado) {
            return interaction.editReply({ content: `❌ Produto selecionado não encontrado.` });
        }

        if (novoNome) produtoEncontrado.nome = novoNome;
        if (novoPrecoStr) {
            const precoParsed = parseFloat(novoPrecoStr.replace(',', '.'));
            if (!isNaN(precoParsed) && precoParsed > 0) {
                produtoEncontrado.preco = precoParsed;
            }
        }

        saveConfig(config);

        produtoEditCache.set(interaction.user.id, { produtoId, acao: 'salvar_edicao' });

        const menuEmojis = await gerarMenuEmojis(interaction.guild, 'select_emoji_editar_produto', produtoId, 1);

        return interaction.editReply({
            content: `✏️ Dados atualizados! Agora, **escolha abaixo o novo emoji visual** para o produto **${produtoEncontrado.nome}**:`,
            components: [menuEmojis]
        });
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('select_emoji_editar_produto_')) {
        const valorSelecionado = interaction.values[0];
        if (valorSelecionado === 'pagina_2' || valorSelecionado === 'pagina_1') return;

        const partesId = interaction.customId.split('_');
        const produtoId = partesId[partesId.length - 1];

        let produtoEncontrado = null;

        for (const cat of config.categorias) {
            if (!cat.produtos) continue;
            const p = cat.produtos.find(prod => prod.id === produtoId || prod.id === (produtoEditCache.get(interaction.user.id)?.produtoId));
            if (p) {
                produtoEncontrado = p;
                break;
            }
        }

        if (!produtoEncontrado) {
            return interaction.update({ content: '❌ Produto não encontrado.', components: [] });
        }

        if (valorSelecionado === 'sem_emoji') {
            produtoEncontrado.emoji = null;
        } else {
            const emojiId = valorSelecionado.replace('custom_', '');
            const emojiObj = interaction.guild.emojis.cache.get(emojiId);
            if (emojiObj) {
                produtoEncontrado.emoji = `<:${emojiObj.name}:${emojiObj.id}>`;
            }
        }

        saveConfig(config);
        produtoEditCache.delete(interaction.user.id);

        return interaction.update({
            content: `✅ Emoji do produto **${produtoEncontrado.nome}** atualizado com sucesso para ${produtoEncontrado.emoji || 'Nenhum'}!`,
            components: []
        });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'select_categoria_loja') {
        const nomeCanalEsperado = `ticket-${interaction.user.username.toLowerCase()}`;
        const ticketExistente = interaction.guild.channels.cache.find(
            c => c.name === nomeCanalEsperado || c.name.startsWith('entregue-') || c.name.startsWith('pendente-')
        );

        if (ticketExistente && ticketExistente.name.includes(interaction.user.username.toLowerCase())) {
            return interaction.reply({
                content: `⚠️ Você já possui um ticket aberto em ${ticketExistente}! Por favor, feche-o antes de abrir um novo.`,
                ephemeral: true
            });
        }

        const catId = interaction.values[0];
        const painelPrivado = montarPainelPrivado(config, catId);

        if (!painelPrivado) {
            return interaction.reply({ content: 'Nenhum produto cadastrado para esta categoria.', ephemeral: true });
        }

        const menuResetado = gerarMenuCategoriasPrincipal(config);
        const rowTermos = gerarRowTermos();

        await interaction.update({ components: [menuResetado, rowTermos] });

        await interaction.followUp({
            ...painelPrivado,
            ephemeral: true
        });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'select_categoria_privada') {
        const catId = interaction.values[0];
        const painelPrivado = montarPainelPrivado(config, catId);

        if (!painelPrivado) {
            return interaction.reply({ content: 'Nenhum produto cadastrado para esta categoria.', ephemeral: true });
        }

        await interaction.update(painelPrivado);
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('select_subprod_')) {
        const catId = interaction.customId.replace('select_subprod_', '');
        selecoesAtivas.set(`${interaction.user.id}_${catId}`, interaction.values);
        await interaction.deferUpdate();
    }

    if (interaction.isButton() && interaction.customId.startsWith('btn_confirmar_selecao_')) {
        const catId = interaction.customId.replace('btn_confirmar_selecao_', '');
        const prodIds = selecoesAtivas.get(`${interaction.user.id}_${catId}`);

        if (!prodIds || prodIds.length === 0) {
            return interaction.reply({ 
                content: '⚠️ Você precisa selecionar pelo menos um produto no menu acima antes de clicar em confirmar!', 
                ephemeral: true 
            });
        }

        const categoria = config.categorias.find(c => c.id === catId);
        if (!categoria) return;

        const produtosSelecionados = categoria.produtos.filter(p => prodIds.includes(p.id)).slice(0, 4);

        const keyTemp = `${interaction.user.id}_${Date.now()}`;
        selecoesTemporarias.set(keyTemp, { catId: catId, prodIds: prodIds });

        const modal = new ModalBuilder()
            .setCustomId(`modal_qtds_${keyTemp}`)
            .setTitle('Quantidades e Perfil do Roblox');

        const robloxInput = new TextInputBuilder()
            .setCustomId('input_roblox_user')
            .setLabel('Seu Nick/Usuário no Roblox:')
            .setPlaceholder('Exemplo: Builderman')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(robloxInput));

        produtosSelecionados.forEach(prod => {
            const qtdInput = new TextInputBuilder()
                .setCustomId(`input_qtd_${prod.id}`)
                .setLabel(`Qtd: ${prod.nome.slice(0, 25)} (R$ ${prod.preco.toFixed(2)})`)
                .setStyle(TextInputStyle.Short)
                .setValue('1')
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(qtdInput));
        });

        await interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_qtds_')) {
        await interaction.deferReply({ ephemeral: true });

        const keyTemp = interaction.customId.replace('modal_qtds_', '');
        const selecao = selecoesTemporarias.get(keyTemp);

        if (!selecao) {
            return interaction.editReply({ content: '❌ As informações do seu pedido expiraram.' });
        }

        const categoria = config.categorias.find(c => c.id === selecao.catId);
        let valorTotalGeral = 0;
        let linhasProdutos = [];

        for (const prodId of selecao.prodIds) {
            const produto = categoria.produtos.find(p => p.id === prodId);
            if (!produto) continue;

            let qtdTexto = '1';
            try {
                qtdTexto = interaction.fields.getTextInputValue(`input_qtd_${prodId}`);
            } catch (e) {
                qtdTexto = '1';
            }

            const qtd = parseInt(qtdTexto);

            if (isNaN(qtd) || qtd <= 0) {
                return interaction.editReply({ 
                    content: `❌ A quantidade inserida para **${produto.nome}** é inválida. Digite apenas números inteiros maiores que zero.`
                });
            }

            const valorItem = produto.preco * qtd;
            valorTotalGeral += valorItem;
            linhasProdutos.push(`• ${qtd}x ${produto.nome} -> **R$ ${valorItem.toFixed(2)}**`);
        }

        const valorMinimoCategoria = categoria.valorMinimo || 0;
        if (valorTotalGeral < valorMinimoCategoria) {
            return interaction.editReply({
                content: `⚠️ **Pedido Mínimo não atingido!**\nO total deu **R$ ${valorTotalGeral.toFixed(2)}**, mas o valor mínimo para a categoria **${categoria.nome}** é de **R$ ${valorMinimoCategoria.toFixed(2)}**.`
            });
        }

        const nickRobloxDigitado = interaction.fields.getTextInputValue('input_roblox_user').trim();
        const perfilRoblox = await buscarPerfilRoblox(nickRobloxDigitado);

        if (!perfilRoblox) {
            return interaction.editReply({
                content: `❌ O usuário do Roblox **"${nickRobloxDigitado}"** não foi encontrado. Verifique a ortografia e tente novamente.`
            });
        }

        const orderKey = `order_${interaction.user.id}_${Date.now()}`;
        robloxPendingData.set(orderKey, {
            valorTotal: valorTotalGeral,
            linhasProdutos: linhasProdutos,
            catId: selecao.catId,
            robloxProfile: perfilRoblox
        });

        const embedConfirmacao = new EmbedBuilder()
            .setTitle('👤 Confirme seu Perfil do Roblox')
            .setDescription(
                `Encontramos a seguinte conta no Roblox:\n\n` +
                `📌 **Nome de Exibição:** ${perfilRoblox.displayName}\n` +
                `🏷️ **Usuário (@):** ${perfilRoblox.name}\n` +
                `🆔 **ID Roblox:** \`${perfilRoblox.id}\` \n\n` +
                `⚠️ **Esta é a sua conta oficial do Roblox onde receberá os itens?**`
            )
            .setThumbnail(perfilRoblox.avatarUrl)
            .setColor('#A020F0');

        const rowBotoes = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`btn_confirmar_roblox_${orderKey}`)
                .setLabel('Sim, confirmar perfil!')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`btn_recusar_roblox_${orderKey}`)
                .setLabel('Não sou eu')
                .setStyle(ButtonStyle.Danger)
        );

        await interaction.editReply({
            embeds: [embedConfirmacao],
            components: [rowBotoes]
        });
    }

    if (interaction.isButton() && interaction.customId.startsWith('btn_recusar_roblox_')) {
        const orderKey = interaction.customId.replace('btn_recusar_roblox_', '');

        const modalTrocarNick = new ModalBuilder()
            .setCustomId(`modal_corrigir_roblox_${orderKey}`)
            .setTitle('Corrigir Usuário do Roblox');

        const nickInput = new TextInputBuilder()
            .setCustomId('input_novo_roblox_user')
            .setLabel('Digite o Usuário/Nick Correto:')
            .setPlaceholder('Exemplo: Builderman')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        modalTrocarNick.addComponents(new ActionRowBuilder().addComponents(nickInput));
        await interaction.showModal(modalTrocarNick);
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_corrigir_roblox_')) {
        await interaction.deferReply({ ephemeral: true });

        const orderKey = interaction.customId.replace('modal_corrigir_roblox_', '');
        const orderData = robloxPendingData.get(orderKey);

        if (!orderData) {
            return interaction.editReply({ content: '❌ As informações do seu pedido expiraram.' });
        }

        const novoNickDigitado = interaction.fields.getTextInputValue('input_novo_roblox_user').trim();
        const perfilRoblox = await buscarPerfilRoblox(novoNickDigitado);

        if (!perfilRoblox) {
            return interaction.editReply({
                content: `❌ O usuário do Roblox **"${novoNickDigitado}"** não foi encontrado. Verifique a ortografia e tente novamente.`
            });
        }

        orderData.robloxProfile = perfilRoblox;
        robloxPendingData.set(orderKey, orderData);

        const embedConfirmacao = new EmbedBuilder()
            .setTitle('👤 Confirme seu Perfil do Roblox')
            .setDescription(
                `Encontramos a seguinte conta no Roblox:\n\n` +
                `📌 **Nome de Exibição:** ${perfilRoblox.displayName}\n` +
                `🏷️ **Usuário (@):** ${perfilRoblox.name}\n` +
                `🆔 **ID Roblox:** \`${perfilRoblox.id}\` \n\n` +
                `⚠️ **Esta é a sua conta oficial do Roblox onde receberá os itens?**`
            )
            .setThumbnail(perfilRoblox.avatarUrl)
            .setColor('#A020F0');

        const rowBotoes = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`btn_confirmar_roblox_${orderKey}`)
                .setLabel('Sim, confirmar perfil!')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`btn_recusar_roblox_${orderKey}`)
                .setLabel('Não sou eu')
                .setStyle(ButtonStyle.Danger)
        );

        await interaction.editReply({
            embeds: [embedConfirmacao],
            components: [rowBotoes]
        });
    }

    if (interaction.isButton() && interaction.customId.startsWith('btn_confirmar_roblox_')) {
        await interaction.deferUpdate();

        const orderKey = interaction.customId.replace('btn_confirmar_roblox_', '');
        const orderData = robloxPendingData.get(orderKey);

        if (!orderData || !orderData.robloxProfile) {
            return interaction.followUp({ content: '❌ Erro ao localizar dados do pedido.', ephemeral: true });
        }

        const roblox = orderData.robloxProfile;
        const guild = interaction.guild;
        const user = interaction.user;

        try {
            const ticketChannel = await guild.channels.create({
                name: `ticket-${user.username}`,
                type: ChannelType.GuildText,
                parent: config.categoriaTicketsId,
                permissionOverwrites: [
                    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles] },
                    { id: ID_STAFF, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
                ]
            });

            const listaProdutosTexto = orderData.linhasProdutos.join('\n');

            const embedTicket = new EmbedBuilder()
                .setTitle('🛒 • Novo Pedido Realizado')
                .setColor('#A020F0')
                .setThumbnail(roblox.avatarUrl)
                .setDescription(
                    `👤 **Cliente (Discord):** ${user}\n\n` +
                    `<:roblox:1531247150762033297> **PERFIL DO ROBLOX CONFIRMADO:**\n` +
                    `• **Usuário:** [@${roblox.name}](${roblox.profileUrl})\n` +
                    `• **Exibição:** ${roblox.displayName}\n` +
                    `• **ID Roblox:** \`${roblox.id}\` \n\n` +
                    `📦 **Produtos no Carrinho:**\n` +
                    `${listaProdutosTexto}\n\n` +
                    `💰 **Total:** R$ ${orderData.valorTotal.toFixed(2)}`
                )
                .setFooter({ text: `Discord ID: ${user.id}`, iconURL: user.displayAvatarURL() });

            const row1 = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('btn_fechar').setLabel('Fechar').setEmoji('🔒').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('btn_pagar').setLabel('Pagar (PIX)').setEmoji('💸').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('btn_pendente').setLabel('Pendente').setEmoji('⏳').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('btn_entregue').setLabel('Entregue').setEmoji('📦').setStyle(ButtonStyle.Primary)
            );

            const row2 = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('btn_editar_valor').setLabel('Editar valor').setEmoji('✏️').setStyle(ButtonStyle.Secondary)
            );

            const msgTicket = await ticketChannel.send({
                content: `${user} aguarde um momento. Equipe <@&${ID_STAFF}>`,
                embeds: [embedTicket],
                components: [row1, row2]
            });

            ticketsData.set(ticketChannel.id, {
                donoId: user.id,
                clienteUser: user,
                robloxProfile: roblox,
                listaTexto: listaProdutosTexto,
                valor: Number(orderData.valorTotal),
                messageId: msgTicket.id
            });

            robloxPendingData.delete(orderKey);

            await interaction.editReply({
                content: `✅ Perfil verificado! Seu ticket foi criado com sucesso em ${ticketChannel}!`,
                embeds: [],
                components: []
            });

        } catch (err) {
            console.error('Erro ao criar ticket:', err);
            await interaction.editReply({ content: '❌ Ocorreu um erro ao criar o ticket.', embeds: [], components: [] });
        }
    }

    if (interaction.isButton() && interaction.customId === 'btn_abrir_suporte_ticket') {
        const guild = interaction.guild;
        const user = interaction.user;

        const nomeCanalSuporte = `suporte-${user.username.toLowerCase()}`;
        const suporteExistente = guild.channels.cache.find(c => c.name === nomeCanalSuporte);

        if (suporteExistente) {
            return interaction.reply({
                content: `⚠️ Você já possui um ticket de suporte aberto em ${suporteExistente}!`,
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            const suporteChannel = await guild.channels.create({
                name: `suporte-${user.username}`,
                type: ChannelType.GuildText,
                parent: ID_CATEGORIA_SUPORTE,
                permissionOverwrites: [
                    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ReadMessageHistory] },
                    { id: ID_STAFF, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
                ]
            });

            const embedSuporteTicket = new EmbedBuilder()
                .setTitle('🎫 • Canal de Suporte e Dúvidas')
                .setColor('#A020F0')
                .setDescription(
                    `Olá ${user}, seja bem-vindo ao seu canal de suporte exclusivo da **DELUXO STORE**!\n\n` +
                    `Por favor, descreva detalhadamente qual é a sua dúvida ou o problema que está enfrentando. Nossa equipe de atendimento irá responder o mais rápido possível.\n\n` +
                    `⚠️ **Lembre-se:** Este canal é dedicado exclusivamente para suporte geral e esclarecimento de dúvidas.`
                )
                .setTimestamp();

            const rowFecharSuporte = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('btn_fechar')
                    .setLabel('Fechar Suporte')
                    .setEmoji('🔒')
                    .setStyle(ButtonStyle.Danger)
            );

            await suporteChannel.send({
                content: `${user} | Equipe <@&${ID_STAFF}>`,
                embeds: [embedSuporteTicket],
                components: [rowFecharSuporte]
            });

            ticketsData.set(suporteChannel.id, {
                donoId: user.id,
                clienteUser: user,
                valor: 0,
                listaTexto: 'Canal de Suporte'
            });

            await interaction.editReply({
                content: `✅ Seu ticket de suporte foi criado com sucesso em ${suporteChannel}!`
            });

        } catch (e) {
            console.error('Erro ao criar ticket de suporte:', e);
            await interaction.editReply({ content: '❌ Ocorreu um erro ao criar o seu ticket de suporte. Verifique as permissões do bot.' });
        }
    }

    if (interaction.isButton() && interaction.customId === 'btn_abrir_modal_avaliacao') {
        const dadosAvaliacao = avaliacoesPendentes.get(interaction.user.id);
        if (!dadosAvaliacao) {
            return interaction.reply({ content: '❌ As informações desta avaliação expiraram ou já foram enviadas.', ephemeral: true });
        }

        const modalAvaliacao = new ModalBuilder()
            .setCustomId('modal_enviar_avaliacao')
            .setTitle('⭐ Avaliar a DELUXO STORE');

        const inputTexto = new TextInputBuilder()
            .setCustomId('input_texto_avaliacao')
            .setLabel('Escreva sua avaliação sobre o atendimento:')
            .setPlaceholder('Ex: Atendimento super rápido e confiável, recomendo demais!')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

        const inputEstrelas = new TextInputBuilder()
            .setCustomId('input_estrelas_avaliacao')
            .setLabel('Nota (de 1 a 10 estrelas):')
            .setPlaceholder('Ex: 10')
            .setStyle(TextInputStyle.Short)
            .setMinLength(1)
            .setMaxLength(2)
            .setRequired(true);

        modalAvaliacao.addComponents(
            new ActionRowBuilder().addComponents(inputTexto),
            new ActionRowBuilder().addComponents(inputEstrelas)
        );

        await interaction.showModal(modalAvaliacao);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'modal_enviar_avaliacao') {
        await interaction.deferReply({ ephemeral: true });

        const textoAvaliacao = interaction.fields.getTextInputValue('input_texto_avaliacao');
        const notaStr = interaction.fields.getTextInputValue('input_estrelas_avaliacao').trim();
        const nota = parseInt(notaStr);

        if (isNaN(nota) || nota < 1 || nota > 10) {
            return interaction.editReply({ content: '❌ Nota inválida! Digite um número inteiro entre **1** e **10** no campo de estrelas.' });
        }

        const dadosAvaliacao = avaliacoesPendentes.get(interaction.user.id);
        const guildId = dadosAvaliacao ? dadosAvaliacao.guildId : GUILD_ID;

        try {
            const guildObj = await client.guilds.fetch(guildId);
            const canalAvaliacoes = await guildObj.channels.fetch(ID_CANAL_AVALIACOES);

            if (canalAvaliacoes) {
                const visualEstrelas = '⭐'.repeat(nota);

                const embedAvaliacaoFinal = new EmbedBuilder()
                    .setTitle('⭐ • Nova Avaliação Recebida!')
                    .setColor('#A020F0')
                    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
                    .setDescription(
                        `👤 **Cliente:** ${interaction.user} (${interaction.user.tag})\n\n` +
                        `🌟 **Nota:** **${nota}/10**\n` +
                        `${visualEstrelas}\n\n` +
                        `💬 **Comentário:**\n"${textoAvaliacao}"`
                    )
                    .setTimestamp();

                await canalAvaliacoes.send({ embeds: [embedAvaliacaoFinal] });
            }

            avaliacoesPendentes.delete(interaction.user.id);
            await interaction.editReply({ content: '✅ **Avaliação enviada com sucesso!** Muito obrigado pelo seu feedback.' });
        } catch (e) {
            console.error('Erro ao enviar avaliação para o canal:', e);
            await interaction.editReply({ content: '❌ Ocorreu um erro ao enviar sua avaliação para o servidor.' });
        }
    }

    if (interaction.isButton()) {
        if (
            interaction.customId.startsWith('btn_confirmar_selecao_') || 
            interaction.customId.startsWith('btn_confirmar_roblox_') || 
            interaction.customId.startsWith('btn_recusar_roblox_') || 
            interaction.customId === 'btn_abrir_modal_avaliacao' || 
            interaction.customId === 'btn_abrir_suporte_ticket' || 
            interaction.customId === 'btn_painel_criar_produto' || 
            interaction.customId === 'btn_painel_editar_produto' ||
            interaction.customId === 'btn_painel_criar_categoria' ||
            interaction.customId === 'btn_painel_editar_categoria' ||
            interaction.customId === 'btn_abrir_painel_precos_privado'
        ) return;

        if (interaction.customId.startsWith('btn_preco_ant_') || interaction.customId.startsWith('btn_preco_prox_')) {
            const partes = interaction.customId.split('_');
            const currentIndex = parseInt(partes[partes.length - 1]);
            const direcao = interaction.customId.includes('_ant_') ? -1 : 1;

            const novoIndex = currentIndex + direcao;
            const painelAtualizado = montarPainelPrecos(config, novoIndex);

            return await interaction.update({
                embeds: painelAtualizado.embeds,
                components: painelAtualizado.components
            });
        }

        const data = ticketsData.get(interaction.channel.id) || {
            donoId: interaction.user.id,
            clienteUser: interaction.user,
            valor: 0,
            listaTexto: 'Itens não especificados'
        };

        const isStaff = interaction.member.roles.cache.has(ID_STAFF);
        const isDono = interaction.user.id === data.donoId;

        if (interaction.customId === 'btn_pagar') {
            if (!isDono && !isStaff) {
                return interaction.reply({ content: '❌ Apenas o comprador pode gerar os dados de pagamento.', ephemeral: true });
            }

            await interaction.deferReply();

            try {
                if (typeof data.valor !== 'number' || data.valor <= 0) {
                    return interaction.editReply({ content: '❌ O valor deste pedido é inválido ou não foi definido.' });
                }

                const idempotencyKey = `order_${interaction.channel.id}_${Date.now()}`;
                const paymentData = {
                    body: {
                        transaction_amount: Number(data.valor.toFixed(2)),
                        description: `Pagamento - Pedido Loja Deluxo`,
                        payment_method_id: 'pix',
                        payer: {
                            email: 'cliente@deluxostore.com',
                        }
                    },
                    requestOptions: {
                        idempotencyKey: idempotencyKey
                    }
                };

                const response = await paymentApi.create(paymentData);

                const qrCodePix = response.point_of_interaction.transaction_data.qr_code;
                const qrCodeBase64 = response.point_of_interaction.transaction_data.qr_code_base64;

                const buffer = Buffer.from(qrCodeBase64, 'base64');
                const attachment = { attachment: buffer, name: 'qrcode-pix.png' };

                const embedPix = new EmbedBuilder()
                    .setTitle('💸 • Pagamento via Pix Gerado')
                    .setColor('#A020F0')
                    .setDescription(
                        `Escaneie o QR Code ao lado pelo aplicativo do seu banco ou utilize o **Pix Copia e Cola** abaixo:\n\n` +
                        `💰 **Valor Exato:** R$ ${data.valor.toFixed(2)}`
                    )
                    .setImage('attachment://qrcode-pix.png');

                await interaction.editReply({
                    content: `🔑 **Pix Copia e Cola:**\n\`\`\`${qrCodePix}\`\`\``,
                    embeds: [embedPix],
                    files: [attachment]
                });

            } catch (error) {
                console.error('Erro ao gerar Pix no Mercado Pago:', error);
                await interaction.editReply({ content: '❌ Ocorreu um erro ao gerar a cobrança Pix automática. Tente novamente mais tarde.' });
            }
            return;
        }

        if (interaction.customId === 'btn_pendente') {
            if (!isStaff) {
                return interaction.reply({ content: '❌ Apenas a equipe autorizada pode marcar como PENDENTE.', ephemeral: true });
            }
            const nomeLimpo = interaction.channel.name.replace(/^(ticket-|entregue-|pendente-)/, '');
            const novoNome = `pendente-${nomeLimpo}`;
            await interaction.channel.setName(novoNome);

            const clienteMencionado = data.clienteUser || `<@${data.donoId}>`;
            return interaction.reply({ content: `${clienteMencionado}, seu pedido foi aprovado por ${interaction.user}, aguarde sua entrega.` });
        }

        if (interaction.customId === 'btn_entregue') {
            if (!isStaff) {
                return interaction.reply({ content: '❌ Apenas a equipe autorizada pode marcar como ENTREGUE.', ephemeral: true });
            }
            const nomeLimpo = interaction.channel.name.replace(/^(ticket-|entregue-|pendente-)/, '');
            const novoNome = `entregue-${nomeLimpo}`;
            await interaction.channel.setName(novoNome);
            
            try {
                const canalLogs = await interaction.guild.channels.fetch(ID_CANAL_LOGS);
                if (canalLogs) {
                    const valorLog = typeof data.valor === 'number' ? data.valor : 0;
                    const embedLog = new EmbedBuilder()
                        .setTitle('📊 • Nova Venda Concluída (Entregue)')
                        .setColor('#A020F0')
                        .setThumbnail(data.robloxProfile ? data.robloxProfile.avatarUrl : null)
                        .setDescription(
                            `👤 **Cliente (Discord):** ${data.clienteUser || `<@${data.donoId}>`}\n` +
                            `👮 **Staff Responsável:** ${interaction.user}\n\n` +
                            `🎮 **Roblox:** ${data.robloxProfile ? `[${data.robloxProfile.displayName} (@${data.robloxProfile.name})](${data.robloxProfile.profileUrl})` : 'Não informado'}\n\n` +
                            `📦 **Produtos Comprados:**\n${data.listaTexto || 'Itens não especificados'}\n\n` +
                            `💰 **Faturamento:** R$ ${valorLog.toFixed(2)}`
                        )
                        .setTimestamp();
                    
                    await canalLogs.send({ embeds: [embedLog] });
                }
            } catch (e) {
                console.error('Erro ao enviar log de venda:', e);
            }

            try {
                const clienteUser = data.clienteUser || await client.users.fetch(data.donoId);
                if (clienteUser) {
                    avaliacoesPendentes.set(clienteUser.id, { guildId: interaction.guild.id });

                    const embedAvaliacao = new EmbedBuilder()
                        .setTitle('⭐ • Sua compra foi finalizada!')
                        .setDescription('Agradecemos muito por comprar na **DELUXO STORE**! Gostaríamos de saber o que achou do atendimento e dos produtos. Clique no botão abaixo para avaliar diretamente por aqui!')
                        .setColor('#A020F0')
                        .setTimestamp();

                    const rowAvaliacao = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId('btn_abrir_modal_avaliacao')
                            .setLabel('Avaliar Loja')
                            .setEmoji('⭐')
                            .setStyle(ButtonStyle.Primary)
                    );

                    await clienteUser.send({
                        embeds: [embedAvaliacao],
                        components: [rowAvaliacao]
                    });
                }
            } catch (e) {
                console.error('Não foi possível enviar DM para o cliente:', e);
            }

            const clienteMencionado = data.clienteUser || `<@${data.donoId}>`;
            return interaction.reply({ content: `${clienteMencionado}, seu produto foi entregue, basta aproveitar do seu produto. volte sempre.` });
        }

        if (interaction.customId === 'btn_editar_valor') {
            if (!isStaff) {
                return interaction.reply({ content: '❌ Apenas a equipe pode alterar valores.', ephemeral: true });
            }

            const modal = new ModalBuilder()
                .setCustomId('modal_editar_valor')
                .setTitle('Editar Valor do Ticket');

            const valorInput = new TextInputBuilder()
                .setCustomId('input_novo_valor')
                .setLabel('Novo Valor Total (ex: 5.00)')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(valorInput));
            await interaction.showModal(modal);
        }

        if (interaction.customId === 'btn_fechar') {
            if (!isDono && !isStaff) {
                return interaction.reply({ content: '❌ Você não tem permissão para fechar este ticket.', ephemeral: true });
            }
            await interaction.reply({ content: '🔒 Apagando canal em 5 segundos...' });
            setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
        }
    }

    if (interaction.isModalSubmit() && interaction.customId === 'modal_editar_valor') {
        const novoValorTexto = interaction.fields.getTextInputValue('input_novo_valor');
        const novoValor = parseFloat(novoValorTexto.replace(',', '.'));

        if (isNaN(novoValor)) {
            return interaction.reply({ content: '❌ Valor inválido. Digite apenas números.', ephemeral: true });
        }

        let data = ticketsData.get(interaction.channel.id);
        if (!data) {
            data = { donoId: interaction.user.id, clienteUser: interaction.user, valor: 0 };
        }

        data.valor = novoValor;
        ticketsData.set(interaction.channel.id, data);

        try {
            if (data.messageId) {
                const msgOriginal = await interaction.channel.messages.fetch(data.messageId);
                const embedAntiga = msgOriginal.embeds[0];

                const novaEmbed = EmbedBuilder.from(embedAntiga)
                    .setDescription(
                        embedAntiga.description.replace(/💰 \*\*Total:\*\* R$ .*/, `💰 **Total:** R$ ${novoValor.toFixed(2)}`)
                    );

                await msgOriginal.edit({ embeds: [novaEmbed] });
            }
            await interaction.reply({ content: `✅ O valor do ticket foi alterado para **R$ ${novoValor.toFixed(2)}**!`, ephemeral: true });
        } catch (error) {
            console.error('Erro ao editar a Embed:', error);
            await interaction.reply({ content: '❌ Erro ao tentar atualizar a mensagem principal.', ephemeral: true });
        }
    }
});

client.login(process.env.DISCORD_TOKEN);