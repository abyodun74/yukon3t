import type { FaqItems } from "../ids";

// Swahili FAQ, part 1: Getting around, The Android app, Posts and media. Conventions as in src/lib/i18n/sw: standard
// Swahili, friendly "wewe"; names of buttons and screens exactly as the app shows them, in «»; product names
// (YuKon3t, Circles, Collab Boards, Muse, Story) as they are.
export const sw1 = {
  "who-join-yukon3t": {
    q: "Nani anaweza kujiunga na YuKon3t?",
    a: "Mtu yeyote mwenye umri wa miaka 16 au zaidi. Unapojisajili tutakuuliza tarehe yako ya kuzaliwa. Ikiwa una miaka 16 au 17, unaweza kutumia YuKon3t tu kwa ushiriki na idhini ya mama yako, baba yako au mlezi wako wa kisheria.",
  },
  "try-without-signing-up": {
    q: "Naweza kujaribu YuKon3t bila kujisajili?",
    a: "Mwonekano wa mgeni ukiwa umewashwa, ndiyo: ukurasa wa yukon3t.com/try una kitufe cha «Chunguza YuKon3t kama mgeni», bila barua pepe na bila nenosiri. Mgeni huona kile anachoona mwanachama mpya: machapisho ambayo waandishi wao wameyaweka kwa Kila mtu, Circles za umma na chaneli zake za umma, video za Muse, Collab Boards, Gundua na wasifu wa watu (jina, picha ya wasifu, wasifu mfupi, nchi na machapisho yao ya Kila mtu), pamoja na maoni, idadi ya waliopenda na orodha ya nani alipenda kwenye machapisho hayo. Mgeni haoni kamwe kitu ambacho mwanachama mpya asingeweza kukiona: si machapisho yaliyowekewa wasiliani tu, si Circles au chaneli za faragha, si ujumbe, wala si Story (ni kwa wasiliani). Wageni hawawezi kuchapisha, kutoa maoni, kupenda wala kuitikia, kuwasiliana, kujisajili kwa mtu, kutuma ujumbe, kupiga simu, kujiunga wala kutazama matangazo ya moja kwa moja, kupiga kura, kujibu matukio wala kuripoti chochote; ukigusa mojawapo ya chaguo hizo, unapewa nafasi ya kufungua akaunti bure. Ziara ya mgeni hudumu hadi saa 2 kisha huisha yenyewe. Wageni hawaonekani kamwe kwenye utafutaji, kwenye Gundua, kwenye orodha za wanachama wala kwenye «nani yuko mtandaoni», na hakuna anayearifiwa kuwa mgeni ameona wasifu wake au machapisho yake. Kinachohifadhiwa wakati wa ziara ya mgeni kimeelezwa kwenye Sera ya faragha.",
  },
  "where-find-everything": {
    q: "Ninapata wapi kila kitu?",
    a: "Kwenye kompyuta, upau wa juu una viungo vya «Mwanzo», «Gundua», «Circles», «Collab Boards», «Muse», «Wasiliani», «Ujumbe» na «Wasifu» wako. Kwenye simu, sehemu sita zinazotumika zaidi («Mwanzo», «Circles», «Collab», «Muse», «Ujumbe», «Wasifu») ziko kwenye upau wa vichupo wa chini, na «Wasiliani» ni ikoni ya mtu kwenye upau wa juu. Gusa menyu ☰ iliyo juu kulia ili uende kwenye «Gundua», «Alika marafiki», «Mipangilio» na, ikiwa wewe ni msimamizi, kwenye zana za usimamizi wa maudhui.",
  },
  "swipe-between-tabs-instead-tapping": {
    q: "Naweza kuteleza kati ya vichupo badala ya kugusa?",
    a: "Ndiyo, kwenye simu: telezesha kulia mahali popote kwenye skrini ili kusonga mbele kupitia Mwanzo → Circles → Collab → Muse → Ujumbe → Wasifu, kisha tena hadi Mwanzo. Telezesha kushoto ili kupitia vichupo hivyohivyo kwa kurudi nyuma, ukizunguka upande mwingine.",
  },
  "difference-between-home-discover-connections": {
    q: "Kuna tofauti gani kati ya Mwanzo, Gundua na Wasiliani?",
    a: "**Mwanzo** ni mtiririko wako: machapisho ya wasiliani wako na ya watu wote wanaochapisha hadharani, ikiwemo machapisho ya Circles za umma. Machapisho ya Circle ya faragha hubaki kwenye Circle hiyo na hayaonekani kamwe hapa. **Gundua** ni ya kupata watu wapya kwa nchi, lugha au mapendeleo. **Wasiliani** ni orodha ya wasiliani wako waliokubaliwa, pamoja na maombi yanayosubiri ambayo umetuma au kupokea.",
  },
  "switch-between-light-dark-mode": {
    q: "Ninabadilishaje kati ya hali angavu na hali nyeusi?",
    a: "Tumia kichagua mandhari kilicho karibu na «Mipangilio» kwenye upau wa juu (au kwenye menyu ☰ kwenye simu). Kwa chaguomsingi hufuata mipangilio ya kifaa chako, lakini unaweza kukiweka kiwe angavu au cheusi kabisa.",
  },
  "yukon3t-work-iphones-accessibility-settings": {
    q: "Je, YuKon3t inafanya kazi na mipangilio ya ufikivu ya iPhone yangu?",
    a: "Ndiyo. Programu ya iPhone inafanya kazi na Voice Control na inaheshimu ukubwa wa maandishi wa iPhone yako: uongeze kwenye Mipangilio → Ufikivu → Onyesho na Ukubwa wa Maandishi → Maandishi Makubwa Zaidi, na maandishi ya YuKon3t yatakua nao, hadi kidogo zaidi ya mara mbili ya ukubwa wa kawaida. Upau wa juu na upau wa vichupo wa chini hukua kidogo tu, ili ikoni na vichupo vyote viendelee kutosha kwenye skrini. Programu pia inaheshimu Punguza Mwendo, na hali nyeusi hufuata kifaa chako isipokuwa uiweke mwenyewe.",
  },
  "megaphone-icon-next-bell": {
    q: "Ikoni ya kipaza sauti iliyo karibu na kengele ni ya nini?",
    a: "Ni «Mapya»: igusa ili uone orodha ya vipengele na maboresho tunayotoa. Inawaka kuna kitu ambacho bado hujakiona, na mara tu jambo jipya linapochapishwa, arifa halisi hutumwa kwenye simu yako, kwa hiyo huhitaji kukumbuka kuangalia. Kila jambo jipya huonekana kwa lugha unayotumia YuKon3t ikiwa tumeliandika kwa lugha hiyo; vinginevyo kwa Kiingereza. Arifa ya simu hufuata kanuni hiyo hiyo, kwa lugha ya arifa zako.",
  },
  "search-app": {
    q: "Natafuta vipi kwenye programu?",
    a: "Gusa ikoni ya kioo cha kukuza iliyo karibu na kengele ya arifa. Kisanduku kimoja cha utafutaji kinahusu watu, Circles, magumzo ya vikundi na ushirikiano kwa wakati mmoja. Unaweza kuchuja matokeo kwa yanayofaa zaidi, mapya zaidi, ya zamani zaidi, «za sasa» (zenye shughuli ndani ya wiki mbili zilizopita) au nchi mahususi.",
  },
  "click-someones-name-almost-everywhere": {
    q: "Kwa nini ninaweza kubofya jina la mtu karibu kila mahali?",
    a: "Jina au picha ya wasifu yoyote unayoiona (kwenye gumzo, maoni, orodha ya wasiliani, orodha ya wanachama wa Circle na kadhalika) inakupeleka moja kwa moja kwenye wasifu wa mtu huyo. Inafanya kazi vivyo hivyo kila mahali kwa makusudi, ili usilazimike kutafuta kitufe cha «tazama wasifu».",
  },
  "some-people-disappear-from-discover": {
    q: "Kwa nini baadhi ya watu hupotea kwenye Gundua?",
    a: "Gundua huonyesha tu watu ambao bado hujawa na mwingiliano wowote wa mawasiliano nao: mara tu unapotuma au kupokea ombi la kuwasiliana, mtu huyo huacha kuonekana kwenye matokeo ya Gundua (liwe bado linasubiri au tayari limekubaliwa). Ombi likikataliwa, mtu huyo anaweza kuonekana tena kwenye Gundua ili ujaribu tena. Ikoni ya utafutaji iliyo juu ya Gundua bado itampata.",
  },
  "search-people-discover": {
    q: "Ninampataje mtu mahususi kwenye Gundua na kuwasiliana naye?",
    a: "Gusa ikoni ya kioo cha kukuza juu ya Gundua na uandike angalau herufi mbili za jina lake au za @jinalamtumiaji lake. Matokeo huonekana unapoandika, kila moja likiwa na kitufe kinachoonyesha hali yenu: «Wasiliana», «Ombi limetumwa», «Kubali» (tayari ameomba kuwasiliana nawe) au «Mnawasiliana», pamoja na «Ujumbe». Hapa unaweza kupata tu watu wanaoonekana kwenye Gundua: akaunti zilizothibitishwa ambazo hazijazima «Onyesha wasifu wangu kwenye Gundua», na kamwe si mtu uliyemzuia au aliyekuzuia. Utafutaji huonyesha watu 60 kwa upeo, kwa hiyo usipomwona unayemtafuta, andika sehemu zaidi ya jina lake. Ni majina na majina ya watumiaji tu yanayotafutwa; barua pepe, nambari za simu na tarehe za kuzaliwa hazitafutwi wala kuonyeshwa kamwe.",
  },
  "new-member-alerts": {
    q: "Kwa nini nilipata arifa kwamba mtu amejiunga na YuKon3t sasa hivi?",
    a: "Mtu mpya anapomaliza kuweka wasifu wake na amethibitisha akaunti yake, YuKon3t huwajulisha wanaotumia Gundua, ili wageni wapate watu wa kuwasiliana nao. Hutangazwa tu kwa wanaoonekana kwenye Gundua: si kwa aliyezima «Onyesha wasifu wangu kwenye Gundua», si kwa mwenye machapisho yanayoonekana kwa wasiliani wake tu, na kamwe si kwa mtu uliyemzuia au aliyekuzuia. Kila mtu hutangazwa mara moja tu, muda mfupi baada ya kujiunga. Simu yako hupata arifa moja tu ya aina hii kila saa 12; watu wengi zaidi wanapojiunga, arifa zako huwakusanya kwenye ingizo moja («Ada na watu 3 zaidi wamejiunga na YuKon3t sasa hivi») linalofungua Gundua likianza na watu wapya zaidi. Ili uache kuzipokea, ondoa alama kwenye Wanachama wapya kwenye Mipangilio → Arifa. Ili usitangazwe unapojiunga, zima «Onyesha wasifu wangu kwenye Gundua» kwenye Mipangilio → Faragha mara tu baada ya kujisajili.",
  },
  "home-split-into-sections-like": {
    q: "Kwa nini Mwanzo imegawanywa katika sehemu kama Kazi, Burudani, Siasa na Michezo?",
    a: "Machapisho hupangwa kulingana na sehemu ya mtiririko ambayo mwandishi wake aliichagua alipoyaandika (kwa chaguomsingi, Kwa ujumla), ili iwe rahisi kuona yanayokuvutia. Ukiwa kwenye ukurasa, kila sehemu huongeza machapisho mapya juu kiotomatiki, kwa kawaida ndani ya sekunde chache na ndani ya karibu nusu dakika wakati mengi yanapochapishwa kwa wakati mmoja. Huhitaji kuonyesha upya.",
  },
  "feed-muse-fresh-mix-latest": {
    q: "Kwa nini mpangilio wa Mwanzo na Muse hubadilika, na nitaonaje mapya zaidi kwanza?",
    a: "Kwa chaguomsingi, Mwanzo (kila sehemu yake) na Muse huonyesha mchanganyiko mpya kila baada ya dakika 15 badala ya kupanga kikamilifu kuanzia mapya zaidi. Machapisho na video mapya zaidi yana uwezekano mkubwa zaidi wa kuwa juu, na ya zamani kutoka wiki iliyopita bado hujitokeza, kwa hivyo ukirudi baadaye unaona kitu tofauti. Kilichochapishwa tangu mchanganyiko wa sasa uanze, pamoja na machapisho yako mwenyewe ya saa 24 zilizopita, hubaki juu, mapya zaidi kwanza. Mpangilio haubadiliki kamwe unaposogeza: mchanganyiko mpya huonekana tu unapofungua au kupakia upya ukurasa. Mchanganyiko hukokotolewa kutokana na akaunti yako, mtiririko na saa tu, si kutokana na unachotazama, unachopenda au unachocheza, na hakuna jipya linalorekodiwa kukuhusu ili kuuunda. Ili kurudi kwenye mapya zaidi kwanza, washa swichi ya **Mapya zaidi** iliyo juu ya Mwanzo au Muse. Inatumika kwa zote mbili na hukumbukwa kwenye kifaa hicho hadi uizime.",
  },
  "update-the-app": {
    q: "Ninasasishaje programu na kwa nini naombwa kuisasisha?",
    a: "Maboresho mengi hukufikia yenyewe: programu hupakia toleo la hivi karibuni la YuKon3t kila unapoifungua. Mabadiliko mengine yanahitaji toleo jipya la programu yenyewe kwenye Google Play au App Store, na likitoka unaweza kuona arifa ya «Sasisho linapatikana»: gusa **Sasisha** ili ufungue duka, kisha ugonge Sasisha huko. «Si sasa» huficha arifa kwa siku 3. Mara chache sana, toleo la zamani linaposhindwa kufanya kazi vizuri tena, utaona badala yake skrini ya «Sasisho linahitajika»; kutoka hapo bado unaweza kufungua maswali haya yanayoulizwa mara kwa mara au kutoka kwenye akaunti, na kila kitu hufanya kazi tena mara unaposasisha. Unaweza pia kusasisha wakati wowote: fungua Google Play au App Store, tafuta YuKon3t kisha ugonge Sasisha. Ili kutuma arifa hizi, toleo na nambari ya muundo wa programu na jukwaa la simu yako (Android au iPhone) huhifadhiwa pamoja na tokeni yake ya arifa za kusukumwa.",
  },
  "links-open-in-app": {
    q: "Je, viungo hufunguka kwenye programu ya YuKon3t?",
    a: "Ndani ya programu, ndiyo. Kwenye programu ya YuKon3t ya Android au iPhone, ukigusa kiungo cha ukurasa wa YuKon3t (yukon3t.com) kwenye gumzo, chapisho, maoni au arifa, ukurasa huo hufunguka papo hapo, ndani ya programu. Viungo vya tovuti nyingine yoyote hufunguka kwenye kivinjari cha simu yako. Kwenye tovuti, kiungo cha YuKon3t hufunguka kwenye kichupo kilekile na tovuti nyingine hufunguka kwenye kichupo kipya.\n\nKila kiungo ambacho YuKon3t huunda ili ushiriki (chapisho, Muse, Circle, ushirikiano, kiungo cha gumzo la kikundi au kiungo unachonakili kwa kubonyeza na kushikilia) ni anwani halisi ya https://yukon3t.com, kwa hiyo hufanya kazi popote unapokituma. Kiungo cha YuKon3t unachogusa kwenye programu nyingine, kama ujumbe mfupi, WhatsApp au barua pepe, kwa sasa hufungua tovuti kwenye kivinjari chako: ili viungo hivyo vifunguke moja kwa moja kwenye programu kunahitajika toleo jipya zaidi la programu, ambalo bado halijatoka.",
  },
  "app-opens-where-left-off": {
    q: "Kwa nini programu hufunguka nilipoiacha?",
    a: "Kwenye programu ya YuKon3t ya Android au iPhone, ukihamia programu nyingine kisha ukarudi, unarudi kwenye skrini ileile: gumzo, wasifu, Circle au ukurasa wa «Mipangilio» uliokuwa ndani yake, au chapisho ulilokuwa ukiandika. Ujumbe mpya wa gumzo lililofunguliwa hupakiwa mara unaporudi na, ikiwa ulikuwa mbali kwa dakika 2 au zaidi, skrini uliyomo husasishwa papo hapo bila kupoteza ulichoandika. Ukigusa arifa, programu inaenda kwa kile ambacho arifa hiyo inahusu. Ikiwa programu ilikuwa imefungwa kabisa (uliifunga kwa kuiteleza au simu yako iliifunga ili kupata kumbukumbu), huanzia Mwanzo, kama kuanza upya kwa kawaida.\n\nMazungumzo yaliyofichwa hubaki yamelindwa: mara unapotoka kwenye programu ukiwa na gumzo lililofichwa kwenye skrini, hufungwa na skrini hufunikwa. Ukirudi, unaombwa PIN yako na, mara unapoiandika, unarudi kwenye gumzo. Ikiwa YuKon3t ilisasishwa ulipokuwa mbali, programu hupakia upya kwenye ukurasa uleule.",
  },
  "slow-connection-data-saver": {
    q: "Je, YuKon3t inafanya kazi kwa muunganisho wa polepole au usio thabiti?",
    a: "Ndiyo. Muunganisho wako ukiwa wa polepole (3G, 4G au 5G yenye mawimbi hafifu, mtandao wa Wi-Fi uliojaa) au kuokoa data kwenye simu yako kumewashwa, YuKon3t hujirekebisha yenyewe: video za mtiririko husubiri uguse kucheza badala ya kuanza unapotelezesha, Muse hupakia tu video unayoitazama, mtiririko hupakia machapisho machache kwa wakati mmoja na kipindi hakirekodiwi kwa takwimu. Unaweza pia kuchagua mwenyewe kwenye Mipangilio → **«Kuokoa data»**: «Kiotomatiki» (chaguomsingi), «Imewashwa» au «Imezimwa». Mpangilio huhifadhiwa kwenye kifaa hicho tu.\n\nKitu kisipopakia, YuKon3t hujaribu tena yenyewe na huonyesha arifa ndogo «Muunganisho wa polepole. Inajaribu tena…» wakati huo. Bila mtandao utaona arifa, na kilichoshindwa kupakia huendelea mara unapounganishwa tena. Kuna mambo ambayo YuKon3t haidhibiti na yanaweza kuendelea kuwa ya polepole: mawimbi ya mtoa huduma wako, video zilizopachikwa kutoka tovuti nyingine na ubora wa simu kwa muunganisho dhaifu sana (simu hurekebisha ubora wao wa video kulingana na muunganisho).",
  },

  "app-opens-chrome-instead-full": {
    q: "Programu inafunguka kwenye Chrome badala ya skrini nzima. Nitairekebishaje?",
    a: "Ikiwa uligusa kiungo cha YuKon3t kwenye programu nyingine (ujumbe mfupi, WhatsApp, barua pepe) na yukon3t.com ikafunguka kwenye Chrome, hilo ndilo linalotarajiwa kwa sasa: viungo vinavyoguswa nje ya programu hufungua tovuti. Ili vifunguke moja kwa moja kwenye programu kunahitajika toleo jipya zaidi la programu, ambalo bado halijatoka. Ili kutumia programu kwenye skrini nzima, ifungue kutoka kwenye ikoni yake kwenye skrini ya mwanzo au kwenye orodha ya programu zako. Viungo vya kurasa za YuKon3t unavyogusa ndani ya programu tayari hufunguka ndani ya programu.",
  },
  "still-get-calls-phone-asleep": {
    q: "Bado nitapokea simu ikiwa simu yangu iko katika hali ya usingizi au imefungwa?",
    a: "Ndiyo. Simu inayoingia hulia na kuwasha skrini juu ya skrini ya kufunga hata simu ikiwa katika hali ya usingizi au ya kuokoa betri (Doze), kama simu ya kawaida. Unaweza kuipokea au kuikataa kutoka kwenye skrini hiyohiyo, au kuigusa ili kufungua programu. Kwa hili, YuKon3t inahitaji ruhusa ya arifa iwe imewashwa (Android huiomba mara ya kwanza unapoingia). Ikiwa simu hazimwamshi simu yako, angalia Mipangilio → Programu → YuKon3t → Arifa. Ikiwa umeingia kwenye zaidi ya simu moja, kupokea au kukataa kwenye moja huzima mlio kwenye zingine, pia kwenye iPhone zilizofungwa.",
  },
  "shows-up-notification-phone": {
    q: "Ni nini kinachofika kama arifa kwenye simu yangu?",
    a: "Simu zinazoingia, simu ulizokosa (zikiwa na jina la aliyepiga), ujumbe (ikiwemo majibu ya Story yako), waliopenda, maoni na mara ambazo machapisho yako na video zako za Muse zinashirikiwa au kushirikiwa tena, maombi ya kuwasiliana, vikumbusho vya matukio, mtu anayeanzisha matangazo ya moja kwa moja nawe peke yako, kipindi kinachojirudia cha ushirikiano kinachokaribia kuanza, na taarifa za jumla kuhusu vipengele vipya. Yote hayo hufika kama arifa halisi kwenye simu yako (Android au iPhone) hata programu ikiwa haijafunguliwa, si tu kwenye ikoni ya kengele ndani ya programu. Kugusa moja (au arifa ya orodha ndani ya programu) hufungua hasa kile inachohusu: chapisho, Muse, Story, gumzo, tukio, Circle, matangazo ya moja kwa moja, ushirikiano au orodha ya Wasiliani (kwa simu uliyokosa, wasifu wa aliyepiga), hata programu ikiwa chinichini au ikipakia upya na toleo jipya inapofunguliwa. Ikiwa kitu hicho kilifutwa baadaye, au kiko kwenye Circle ya faragha ambayo huna tena, utaona ukurasa wa «haikupatikana». Kufungua programu (kutoka kwenye arifa, kwenye ikoni yake au ukirudi kutoka programu nyingine) hufuta kiotomatiki arifa zote za aina hii kwenye paneli ya arifa. Isipokuwa pekee ni simu inayolia au simu uliyokosa, ambazo hubaki hadi ushughulikie simu hiyo. Orodha ya arifa ndani ya programu hufanya kazi tofauti: arifa huwekwa kuwa imesomwa unapoifungua kutoka kwenye orodha, unapogusa arifa yake kwenye simu au unapofungua kinachohusu (mazungumzo, chapisho, Muse, Circle na kadhalika). Zingine hubaki hazijasomwa, na kiashiria chekundu cha kengele kinaendelea kuzihesabu, hadi hapo au hadi ugonge «Weka zote kuwa zimesomwa».",
  },
  "turning-up-phones-volume-unmutes": {
    q: "Kuongeza sauti ya simu kunawasha sauti ya video kwenye mtiririko wangu. Je, ni kawaida?",
    a: "Ndiyo, ni makusudi. Video za mtiririko hushiriki mpangilio mmoja wa sauti kwa programu nzima (gusa ikoni ya spika ya video yoyote au ongeza sauti ya simu): ukiwasha sauti, huwaka kwa video zote za mtiririko wako, ikiwemo zile utakazoziona baadaye unapotelezesha, kama kwenye mtiririko wa Instagram.",
  },

  post: {
    q: "Naweza kuchapisha nini?",
    a: "Maandishi, picha na video kutoka kwenye kifaa chako au kamera, picha iliyochukuliwa kutoka kwenye URL au kiungo kilichopachikwa cha YouTube au Vimeo. Gusa ikoni za kamera na picha kwenye kihariri: kila moja hufungua menyu ndogo yenye kifaa, kamera au kiungo, kwa hiyo kuna kitufe kimoja cha picha na kimoja cha video badala ya safu ya vitufe tofauti.",
  },
  "which-video-formats-upload-everyone": {
    q: "Ni miundo ipi ya video ninayoweza kupakia? Je, kila mtu anaweza kuziona?",
    a: "MP4, WebM na QuickTime (.mov, kinachorekodiwa na iPhone), hadi GB 2. .mov hubadilishwa chinichini kuwa MP4 ya kawaida ili ichezwe kwenye vivinjari vyote, si Safari tu. Kwa kawaida inachukua dakika chache na, hadi imalize, ya asili huchezwa kwa wanaotumia kivinjari kinachoiunga mkono. Ikiwa video haiwezi kubadilishwa, ya asili hubaki kama ilivyo.",
  },
  "was-photo-video-rejected": {
    q: "Kwa nini picha au video yangu ilikataliwa, au kwa nini inakaguliwa?",
    a: "Kila kinachopakiwa hupitia ukaguzi wa kiotomatiki kabla mtu mwingine yeyote hajakiona, na maudhui yanayokiuka [Kanuni zetu za jumuiya](/legal/guidelines) (kinachotokea mara nyingi zaidi ni maudhui ya ngono waziwazi) hayachapishwi kamwe. Ukaguzi unapolitia alama chapisho lenye picha au video, chapisho huhifadhiwa lakini hufichwa kwa kila mtu isipokuwa wewe, na wasimamizi wetu hulikagua: hulichapisha kama ulivyolichapisha au hulifuta. Utaona taarifa kuwa linasubiri ukaguzi na huhitaji kulipakia tena. Wakati linasubiri ukaguzi, maandishi yake hayawezi kuhaririwa. Chapisho lililozuiwa ambalo hakuna aliyelikagua ndani ya siku 14 hufutwa pamoja na picha au video yake. Pia, muda mfupi baada ya kuchapishwa, kila video hukaguliwa yote: modeli ya AI ya mtoa huduma wetu wa usimamizi huchunguza fremu zilizochukuliwa kutoka kwenye video nzima. Ikipata tatizo, ikiwa haina uhakika, au ikishindwa kuchakata video, video hufichwa vivyo hivyo hadi msimamizi aikague, na haifutwi inaposubiri. Kinachoangukia kwenye aina kali zaidi (kama maudhui ya ngono yanayohusisha watoto) hukataliwa na hufutwa mara moja, na kamwe haihifadhiwi kwa ukaguzi. Upakiaji ukishindwa kwa sababu ya tatizo upande wetu, programu inasema hivyo na inatosha kujaribu tena.",
  },
  "photo-video-upload-failed": {
    q: "Picha au video yangu haikupakiwa. Nifanye nini?",
    a: "Chapisho likishindwa kutumwa, hurudi kwenye kihariri likiwa na maandishi yako, hadhira yako na viambatisho vyako, ujumbe unaoeleza kilichoshindwa, na kitufe cha **Jaribu tena**. «Jaribu tena» hurudia tu kisichokamilika: picha au video iliyokwisha pakiwa haipakiwi tena, na ikiwa chapisho huenda tayari lilichapishwa, kujaribu tena hakulichapishi mara mbili kamwe. Ujumbe ukisema picha au video haiwezi tena kusomwa, ichague tena kisha ugonge «Chapisha». Kwenye kihariri cha Story, picha au video isiyoweza kuchapishwa huonyesha ujumbe wake yenyewe wenye sababu na cha kujaribu (kwa mfano, nakala ya JPEG au PNG ya picha isiyofunguka). Rekodi za skrini za iPhone, video za .MP4 na picha za HEIC zinaungwa mkono.\n\nUpakiaji unaposhindwa, programu hututumia dokezo fupi la kiufundi ili tuweze kupata chanzo: hatua ipi ilishindwa, msimbo wa hitilafu, aina ya faili, ukubwa au muda wake wa takriban, na kama ulikuwa kwenye Android, iPhone au wavuti. Kamwe halijumuishi faili, jina lake wala maudhui yake.",
  },
  "delete-post-report-someone-elses": {
    q: "Ninafutaje chapisho au maoni, au kuripoti chapisho la mtu mwingine?",
    a: "Fungua menyu ya «⋯» ya chapisho lolote ili kulifuta (ikiwa ni lako) au kuliripoti (liwe la nani yeyote). Ripoti huenda kwenye foleni yetu ya usimamizi na hukaguliwa; katika matokeo yoyote kati ya mawili, sababu hutolewa. Kufuta maoni au jibu, kwenye chapisho, Muse au Story, daima kunaomba uthibitishe kwanza («Futa maoni haya?») na kunaonyesha kama majibu yake yatafutwa nayo. «Ghairi» ndiyo chaguomsingi, na hakuna kinachofutwa hadi ugonge «Futa». Hii inajumuisha maoni unayoyaondoa kwenye chapisho lako mwenyewe au kwenye Muse yako.",
  },
  "share-post": {
    q: "Nashirikije chapisho?",
    a: "Gusa ikoni ya kushiriki kwenye chapisho lolote ili kufungua menyu: nakili kiungo, shiriki kwa menyu ya kushiriki ya kifaa chako, liongeze kwenye Story yako, lishiriki kwenye Muse (machapisho yenye video ya hadi dakika 5 tu), litume moja kwa moja kwa rafiki kama ujumbe au lishiriki kwenye Circle. Kushiriki kupitia kifaa huambatisha picha au video yenyewe inapowezekana (si kiungo tu), pamoja na nembo ndogo ya yukon3t, ili programu kama WhatsApp au Ujumbe zionyeshe chapisho halisi lenye alama ya mahali lilipotoka. Kwenye «Tuma kwa rafiki» unaweza kuchagua hadi mazungumzo 5 na kulituma kwa wote kwa wakati mmoja; hivyohivyo hufanya kazi unaposhiriki Muse, Story au kitu unachoshiriki kutoka programu nyingine. Magumzo ya siri hayaonekani kwenye orodha hiyo: unachoshiriki hakiingii kamwe kwenye gumzo la siri, kwa sababu hakiwezi kusimbwa kwenye simu yako. Ikoni ya kushiriki huonekana tu kwenye machapisho yaliyoshirikiwa na Kila mtu: chapisho la Marafiki pekee au la Faragha haliwezi kuchapishwa tena, kuongezwa kwenye Story ya mtu mwingine wala kushirikiwa kwenye Muse au Circle.",
  },
  "share-photo-video-from-another": {
    q: "Naweza kushiriki picha au video kutoka programu nyingine (Instagram, TikTok, WhatsApp na kadhalika) moja kwa moja kwenye YuKon3t?",
    a: "Ndiyo: kwenye menyu ya kushiriki ya programu hiyo (ghala lako, au mara baada ya kupiga picha ya skrini), chagua YuKon3t kama mahali pa kwenda. Kisanduku kidogo hufunguka mara moja chenye onyesho la awali na maandishi ya hiari, kinachokuruhusu kukiongeza kwenye Story yako, kukichapisha kwenye Muse, kukichapisha kwenye mtiririko wako wa Mwanzo, kukichapisha kwenye mojawapo ya Circles zako au kukituma kwa hadi mazungumzo 5. Chagua chaguo moja na kinachapishwa mara moja (baada ya kupita ukaguzi uleule wa kiotomatiki wa maudhui na kanuni zilezile kama unapochapisha kutoka kwenye programu), bila kugusa zaidi wala kwenda kando kwenye kihariri. Picha au picha za skrini nyingi kwa wakati mmoja huwa albamu moja kwenye Mwanzo au kwenye Circle, na ujumbe mmoja kwa kila picha kwenye gumzo. Orodha ya Circles huonyesha tu Circles na chaneli ambazo unaweza kuchapisha; mmiliki na wasimamizi wenza wa Circle pia huona huko chaneli zake za faragha. Hufanya kazi vizuri zaidi programu nyingine inapotoa faili halisi ya picha au video. Kitendo cha kushiriki cha baadhi ya programu hutuma tu kiungo cha chapisho lake lenyewe (ni uamuzi wa kila programu, si kitu ambacho YuKon3t inadhibiti; Instagram na TikTok, miongoni mwa nyingine, kwa kawaida hutoa faili kwa programu washirika wachache tu). Hilo likitokea na kiungo ni cha jukwaa la video linalotambulika (YouTube, Vimeo, TikTok, Instagram, Facebook, Dailymotion), YuKon3t bado inakupa Story, Muse na mtiririko: video halisi huchezwa papo hapo, kama unapobandika kiungo kimoja kati ya hivyo moja kwa moja kwenye kihariri cha mtiririko, tofauti ni kwamba inasimamiwa na jukwaa hilo na si YuKon3t. Kwa kiungo kingine chochote, YuKon3t hukujulisha na bado unaweza kukituma kwa rafiki kutoka kwenye kisanduku kilekile. Hufanya kazi kwenye programu ya Android na kwenye iPhone (YuKon3t 1.2 au baadaye) kwa picha, picha za skrini, video na viungo. Kwenye Android kisanduku hufunguka mara moja. Kwenye iPhone, baada ya kuchagua YuKon3t kwenye menyu ya kushiriki, ulichoshiriki huhifadhiwa na huonekana «Imehifadhiwa. Fungua YuKon3t ili uchague pa kukishiriki.». Fungua YuKon3t na kisanduku kilekile huonekana, ambapo unachagua mahali pa kwenda: mtiririko wako wa Mwanzo, Circle uliyomo (chaneli ambazo unaweza kuchapisha), ujumbe kwa rafiki, au Story au Muse yako.",
  },
  "react-post-something-other-than": {
    q: "Naweza kuitikia chapisho kwa kitu kingine zaidi ya moyo?",
    a: "Ndiyo. Ikoni ya uso wa tabasamu iliyo karibu na moyo kwenye chapisho lolote (au kwenye ujumbe) hufungua kwanza safu ya haraka ya miitikio ya kawaida, pamoja na «+» ya kufungua kichagua kamili cha emoji ukitaka kingine. Ukichagua emoji ileile tena, huondolewa, na ukichagua tofauti, hubadilishwa. Hii ni tofauti na kitufe cha moyo au «Penda», kwa hiyo unaweza kulipenda chapisho na pia kuliongezea mwitikio wa emoji. Kichagua kamili (kwenye machapisho, maoni na magumzo) pia kinaelewa maneno ya utafutaji yasiyo rasmi na yasiyo ya Kiingereza: ukiandika «pray», «amen»/«ameen»/«aameen» au «sad» huonekana safu ndogo ya «Zilizopendekezwa» yenye emoji zinazohusiana, juu ya matokeo ya kawaida.",
  },
  "change-emoji-look-throughout-app": {
    q: "Naweza kubadilisha jinsi emoji zinavyoonekana kwenye programu nzima?",
    a: "Ndiyo. Kwenye Mipangilio → «Mtindo wa emoji», chagua kati ya mtindo wa asili, wa Apple, wa Google, wa Facebook au wa Twitter/X. Unachochagua kinatumika kila mahali emoji zinapoonekana: miitikio, kichagua na ujumbe.",
  },
  "send-gif": {
    q: "Naweza kutuma GIF?",
    a: "Ndiyo. Kitufe cha GIF (karibu na kitufe cha emoji) kwenye kihariri cha machapisho, kwenye gumzo au kwenye kisanduku cha maoni hufungua kitafutaji. Chagua moja ili kuiambatisha, kama unavyoambatisha picha.",
  },
  "videos-feed-play-automatically-no": {
    q: "Kwa nini video za mtiririko wangu huchezwa zenyewe na bila sauti?",
    a: "Video za mtiririko huchezwa kiotomatiki kimyakimya unapozifikia ukitelezesha na husitishwa unapozipita. Gusa ikoni ya spika ya video ili kuwasha sauti (angalia «Kuongeza sauti ya simu kunawasha sauti ya video kwenye mtiririko wangu», hapo juu) au gusa video ili kuisitisha au kuendelea. Kwenye Mwanzo, kugusa video fupi (hadi dakika 5) huifungua kwenye skrini nzima kwenye Muse, ikiwa na sauti: endelea kutelezesha ili kuona Muse zaidi na uifunge au urudi nyuma ili kurudi mahali pale pale kwenye mtiririko wako. Kitufe cha kucheza cha video bado huisitisha papo hapo. Ukigusa jina au kiungo kwenye mwonekano huo wa skrini nzima, kwanza hufungwa kisha ukurasa hufunguka, kwa hiyo ukirudi nyuma kutoka hapo unarudi kwenye mtiririko wako.",
  },
  "zoom-back-out-photo-without": {
    q: "Ninarudisha vipi picha iliyokuzwa bila kufunga kitazamaji?",
    a: "Gusa mara moja picha iliyokuzwa (mguso mmoja, si mara mbili) ili irudi kwenye ukubwa wake wa awali. Kugusa mara mbili bado kunakuza na kupunguza kama kawaida; hii inaongeza tu njia ya haraka zaidi ya kurudi kwenye ukubwa wa kawaida bila kutoka kwenye kitazamaji.",
  },
  "dictate-post": {
    q: "Naweza kuandika chapisho kwa sauti badala ya kuandika kwa mkono?",
    a: "Ndiyo. Gusa ikoni ya maikrofoni kwenye kihariri cha machapisho (au kwenye kisanduku cha ujumbe cha gumzo) ili kurekodi sauti fupi; hunukuliwa na huonekana kwenye kisanduku cha maandishi ili uikague na kuihariri kabla ya kuchapisha au kutuma. Si sawa na kitufe cha mviringo cha maikrofoni/kutuma cha gumzo, kinachotuma rekodi kama ilivyo kama ujumbe wa sauti: maikrofoni ya kuandika kwa sauti iko karibu na kitufe cha emoji na daima hutoa maandishi yanayoharirika. Zungumza kwa lugha yako: Kiswahili, Kihispania, Kifaransa, Kireno, Kiarabu na nyingine nyingi hutambuliwa kiotomatiki, bila kujali unaiona programu kwa lugha gani.",
  },
  "difference-between-connect-subscribe": {
    q: "Kuna tofauti gani kati ya Wasiliana na Jisajili?",
    a: "**Wasiliana** ni ombi la kuwasiliana la pande mbili la kawaida: unachagua sababu ya kuwasiliana (urafiki, kubadilishana tamaduni, kikazi, jumuiya au vidokezo vya safari), mtu mwingine lazima akubali na hilo huwezesha ujumbe na simu kati yenu. **Jisajili** ni la upande mmoja na halihitaji idhini: ukijisajili kwa mtu, unapata arifa kila anapochapisha, anapoongeza Story, anapochapisha tena kitu, anapotangaza moja kwa moja, anapothibitisha kuhudhuria tukio, anapopakia Muse, anapoanzisha ushirikiano au anapounda Circle au kujiunga na moja. Unaweza kujisajili kwa mtu bila kuwa naye kwenye wasiliani wako, na kinyume chake. Isipokuwa tu kwamba kukubali ombi la kuwasiliana humsajili kila mmoja kwa mwenzake kiotomatiki, kwa hiyo huhitaji kujisajili tena kwa mtu ambaye tayari mnawasiliana. Baadaye unaweza kughairi usajili bila kuathiri mawasiliano yenyewe. Ikoni hizo mbili ziko karibu na ikoni ya kushiriki kwenye kila chapisho unaloliona: kwenye Mwanzo, kwenye mtiririko wa Circle, kwenye matokeo ya utafutaji na kwenye machapisho ya Collab Boards. Machapisho ya Circle ya umma huwaarifu wasajili na wasiliani wako kama chapisho lolote la umma. Ya Circle ya faragha ni ya wanachama wake tu, kwa hiyo hayamwarifu mtu wa nje na hayawezi kuchapishwa tena wala kushirikiwa nje yake.",
  },
  "see-who-im-subscribed-whos": {
    q: "Naonaje ni nani nimejisajili kwake au nani amejisajili kwangu?",
    a: "Fungua wasifu wa mtu yeyote, ikiwemo wako, na ugonge idadi ya wasajili au ya usajili iliyo karibu na jina lake ili kuona orodha kamili. Kutoka kwenye orodha hizo unaweza kujisajili kwa mtu yeyote au kughairi usajili moja kwa moja, si kutoka kwenye chapisho tu.",
  },
  "people-you-may-know-discover": {
    q: "«Watu unaoweza kuwajua» kwenye Gundua ni nini?",
    a: "Safu ya mapendekezo karibu na juu ya Gundua, iliyopangwa kwa wasiliani mnaoshirikiana: watu ambao bado hujawasiliana nao na wana wasiliani mnaoshirikiana nawe, pamoja na idadi ya wasiliani mnaoshirikiana. Ni mapendekezo tu: kuonekana hapo hakumwarifu mtu yeyote wala hakufanyi kitu chochote chenyewe; ni njia ya haraka zaidi ya kupata watu ambao huenda tayari unawajua kuliko kuchuja orodha nzima ya Gundua. Huonekana tu ukiwa na angalau mwasiliani mmoja.",
  },
  "long-post-get-cut-off": {
    q: "Kwa nini chapisho refu hukatwa na kiungo cha «Onyesha zaidi»?",
    a: "Machapisho yanayozidi urefu fulani hufupishwa kwenye mitiririko ili chapisho moja refu lisisukume kila kitu kingine chini. Gusa «Onyesha zaidi» ili usome kilichobaki papo hapo na «Onyesha pungufu» ili ulikunje tena. Hii inatumika kila mahali machapisho yanapoorodheshwa, na pia kwa maandishi ya mtu mwenyewe kwenye chapisho lililochapishwa tena. Hakuna kikomo kinachojalisha kwa urefu wa chapisho: andika kila unachohitaji, na msomaji ataweza daima kulipanua.",
  },
  "got-message-saying-new-version": {
    q: "Nilipochapisha nilipata ujumbe unaosema kuna toleo jipya la programu na nionyeshe upya ukurasa ili niendelee.",
    a: "Huonekana kichupo chako kilipokuwa kimefunguliwa tangu kabla hatujatoa sasisho. Si tatizo la muunganisho, ni ukurasa wa zamani tu. Onyesha upya ukurasa kisha ujaribu tena: hakuna kinachopotea kwa kujaribu tena kile ulichokuwa ukichapisha.",
  },
  "there-way-see-older-posts": {
    q: "Je, kuna njia ya kuona machapisho ya zamani kwenye wasifu, kwenye Circle au kwenye matokeo ya utafutaji?",
    a: "Ndiyo. Kwenye YuKon3t nzima, vitu vya zamani zaidi hupakiwa vyenyewe unapotelezesha, iwe kwenye **Mwanzo**, kwenye machapisho ya wasifu, kwenye mtiririko wa chaneli ya Circle, kwenye matokeo ya utafutaji, kwenye Wasiliani au kwenye orodha za wasajili na usajili. Hakuna cha kugusa. (Tofauti na hilo, Mwanzo huongeza machapisho mapya juu kiotomatiki, kwa kawaida sekunde chache baada ya kuchapishwa; hilo ni tofauti na kupakia kilicho nyuma zaidi kwenye mtiririko.)",
  },
} satisfies Partial<FaqItems>;
