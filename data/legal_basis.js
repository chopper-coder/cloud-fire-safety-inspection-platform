'use strict';

(() => {
  const LAW_BASE = 'https://law.moj.gov.tw';
  const PCC_BASE = 'https://www.pcc.gov.tw';
  const DATA_AS_OF = '2026-07-25';
  const DATA_AS_OF_LABEL = '115年7月25日';
  const VERIFIED = window.VERIFIED_LEGAL_DATA || { laws: {}, verifiedArticles: [], comparisons: [] };
  const VERIFIED_ARTICLES = new Set(Array.isArray(VERIFIED.verifiedArticles) ? VERIFIED.verifiedArticles : []);

  const catalog = {
    '政府採購法': {
      pcode: 'A0030057',
      revisionDate: '108年5月22日',
      aliases: ['採購法', '政府採購法'],
      summary: '規範政府採購的招標、決標、履約、驗收、爭議處理及罰則。'
    },
    '政府採購法施行細則': {
      pcode: 'A0030058',
      revisionDate: '110年7月14日',
      aliases: ['採購法施行細則', '政府採購法施行細則', '施行細則'],
      summary: '補充政府採購法的程序、金額計算、開標、決標、履約及驗收細節。'
    },
    '中央機關未達公告金額採購招標辦法': {
      aliases: ['中央機關未達公告金額採購招標辦法', '未達公告金額採購招標辦法'],
      summary: '規範未達公告金額採購的公開取得報價、企劃書、議價及小額採購程序。'
    },
    '招標期限標準': {
      aliases: ['招標期限標準'],
      summary: '規範公告、邀標至截止投標或收件的合理等標期限及縮短條件。'
    },
    '投標廠商資格與特殊或巨額採購認定標準': {
      aliases: ['投標廠商資格與特殊或巨額採購認定標準', '廠商資格與特殊或巨額採購認定標準'],
      summary: '規範基本資格、特定資格及特殊、巨額採購的認定與資格限制。'
    },
    '押標金保證金暨其他擔保作業辦法': {
      aliases: ['押標金保證金暨其他擔保作業辦法', '押標金保證金及其他擔保作業辦法'],
      summary: '規範押標金、履約保證金、保固保證金及其他擔保的額度、繳納與退還。'
    },
    '共同投標辦法': {
      aliases: ['共同投標辦法'],
      summary: '規範共同投標的適用、協議書、成員責任及履約方式。'
    },
    '最有利標評選辦法': {
      aliases: ['最有利標評選辦法'],
      summary: '規範最有利標的評選項目、配分、評定方式及工作小組作業。'
    },
    '採購評選委員會組織準則': {
      aliases: ['採購評選委員會組織準則'],
      summary: '規範評選委員會的成立、委員組成、專家學者比例及迴避。'
    },
    '採購評選委員會審議規則': {
      aliases: ['採購評選委員會審議規則'],
      summary: '規範評選委員會會議、出席、評分、評比及保密等審議程序。'
    },
    '機關委託技術服務廠商評選及計費辦法': {
      aliases: ['機關委託技術服務廠商評選及計費辦法', '技術服務廠商評選及計費辦法'],
      summary: '規範技術服務廠商評選、服務範圍及建造費用百分比法等計費方式。'
    },
    '機關委託專業服務廠商評選及計費辦法': {
      aliases: ['機關委託專業服務廠商評選及計費辦法', '專業服務廠商評選及計費辦法'],
      summary: '規範專業服務採購的公開評選、評選項目及服務費用。'
    },
    '機關委託資訊服務廠商評選及計費辦法': {
      aliases: ['機關委託資訊服務廠商評選及計費辦法', '資訊服務廠商評選及計費辦法'],
      summary: '規範資訊服務廠商評選及計費。'
    },
    '機關委託社會福利服務廠商評選及計費辦法': {
      aliases: ['機關委託社會福利服務廠商評選及計費辦法', '社會福利服務廠商評選及計費辦法'],
      summary: '規範社會福利服務廠商評選及服務費用。'
    },
    '採購契約要項': {
      aliases: ['採購契約要項'],
      summary: '提供採購契約應約定事項、履約管理、契約變更、付款及違約責任的原則。'
    },
    '採購申訴審議規則': {
      aliases: ['採購申訴審議規則'],
      summary: '規範採購申訴的提出、補正、審議及判斷程序。'
    },
    '政府採購公告及公報發行辦法': {
      aliases: ['政府採購公告及公報發行辦法', '政府採購公告及公報發行辦法'],
      summary: '規範招標、決標等公告內容、刊登方式及期限。'
    },
    '電子採購作業辦法': {
      aliases: ['電子採購作業辦法', '電子化採購作業辦法'],
      summary: '規範電子領標、投標、開標、決標及電子資料效力。'
    }
  };

  const articleSummary = {
    '政府採購法:4': '法人或團體接受機關補助辦理採購，符合補助比例及公告金額條件時適用採購法並受監督。',
    '政府採購法:5': '機關得委託法人或團體代辦採購；受託者辦理採購仍適用採購法並受委託機關監督。',
    '政府採購法:6': '採購應維護公共利益及公平合理，不得對廠商為無正當理由的差別待遇。',
    '政府採購法:7': '界定工程、財物、勞務及兼有二種以上性質採購的歸屬。',
    '政府採購法:12': '查核金額以上採購的開標、比價、議價、決標及驗收，應依規定報請上級機關監辦。',
    '政府採購法:13': '公告金額以上採購原則上由主（會）計及有關單位會同監辦。',
    '政府採購法:14': '不得意圖規避採購法而分批辦理；必要分批時應依總金額核計採購金額。',
    '政府採購法:15': '規範採購人員離職後旋轉門及本人、配偶、親屬等利益衝突迴避。',
    '政府採購法:18': '招標方式分為公開招標、選擇性招標及限制性招標。',
    '政府採購法:19': '公告金額以上採購原則上應公開招標，法律另有規定者除外。',
    '政府採購法:20': '列舉得採選擇性招標的情形。',
    '政府採購法:21': '選擇性招標得建立合格廠商名單，並應提供平等受邀機會。',
    '政府採購法:22': '列舉公告金額以上採購得採限制性招標的法定事由，包括公開評選專業、技術、資訊或社福服務。',
    '政府採購法:23': '未達公告金額採購的招標方式由中央或地方主管機關另定。',
    '政府採購法:24': '機關得基於效率及品質以統包方式，將設計與施工、供應、安裝或維修等併案招標。',
    '政府採購法:25': '共同投標須於招標文件允許，成員共同具名投標、簽約並負連帶履約責任。',
    '政府採購法:26': '技術規格應依功能或效益訂定，不得不當限制競爭；提及特定商標時原則上須加註「或同等品」。',
    '政府採購法:27': '公開或選擇性招標應刊登公告並公開於資訊網路。',
    '政府採購法:28': '等標期應訂定合理期限，具體期限依招標期限標準。',
    '政府採購法:29': '招標文件應公開提供，且不得登記領標廠商名稱；內容應含投標所需必要資料。',
    '政府採購法:30': '規範押標金、保證金的收取原則、例外及可接受的繳納方式。',
    '政府採購法:31': '規範押標金發還、不予發還或追繳的法定事由與時效。',
    '政府採購法:32': '招標文件應敘明保證金不發還及擔保責任的事由與範圍。',
    '政府採購法:33': '規範投標文件送達、電子傳輸及非契約必要之點文件的補正。',
    '政府採購法:34': '規範招標文件、底價、領標投標廠商資訊及投標文件的保密。',
    '政府採購法:36': '機關得訂基本資格；特殊或巨額採購得另訂特定資格。',
    '政府採購法:37': '資格條件不得不當限制競爭，並以履約所必須的能力為限。',
    '政府採購法:39': '機關得委託廠商辦理專案管理，但應避免承辦專案管理者與設計、施工或供應廠商的利益衝突。',
    '政府採購法:41': '廠商得就招標文件請求釋疑；涉及文件變更時應依法公告或通知並視需要延長等標期。',
    '政府採購法:45': '公開及選擇性招標的開標原則上應依公告時間、地點公開辦理。',
    '政府採購法:46': '原則上應訂定底價，並依圖說、規範、契約、成本、市場行情及決標資料逐項編列與核定。',
    '政府採購法:47': '特殊複雜、最有利標及小額採購等得不訂底價，但須敘明理由與決標條件。',
    '政府採購法:48': '公開招標原則上須有三家以上合格廠商投標才開標決標，法定例外除外。',
    '政府採購法:50': '規範投標文件不合規定、借牌圍標、重大異常等不予開標或不予決標事由。',
    '政府採購法:51': '機關審查投標文件有疑義時，得通知廠商提出說明。',
    '政府採購法:52': '規範最低標、最有利標及複數決標等決標原則。',
    '政府採購法:53': '最低標超過底價時，得辦理減價及比減價，並受法定程序與上限拘束。',
    '政府採購法:54': '最低標超過評審委員會建議金額或預算時的減價及決標程序。',
    '政府採購法:56': '最有利標應依招標文件所列評選項目、子項及評定方式辦理。',
    '政府採購法:58': '最低標價格顯不合理並有降低品質或不能誠信履約之虞時，得要求說明或擔保。',
    '政府採購法:61': '公告金額以上採購原則上應於決標後公告結果並通知投標廠商。',
    '政府採購法:63': '各類採購契約以採用主管機關範本為原則，並應約定錯誤或管理不善的損害責任。',
    '政府採購法:65': '工程、勞務契約原則上應由得標廠商自行履行，不得轉包。',
    '政府採購法:67': '得標廠商得合法分包，但分包與轉包不同，且分包責任仍受法律規範。',
    '政府採購法:70': '工程採購應明訂品質、環境與施工安全責任，並得辦理分段查驗。',
    '政府採購法:71': '規範驗收程序、驗收人員及書面驗收等事項。',
    '政府採購法:72': '驗收結果與契約、圖說或貨樣不符時，原則上應限期改善、拆除、重作、退貨或換貨；符合條件者得減價收受。',
    '政府採購法:73': '驗收合格後應填具結算驗收證明書，法定例外除外。',
    '政府採購法:74': '招標、審標、決標爭議得依異議及申訴程序處理。',
    '政府採購法:75': '規範異議提出期間及招標機關處理期限。',
    '政府採購法:76': '規範公告金額以上採購申訴的提出期間及受理機關。',
    '政府採購法:85-1': '履約爭議可向採購申訴審議委員會申請調解，或依法提付仲裁。',
    '政府採購法:87': '處罰以強暴、脅迫、詐術、合意或其他非法方式妨害投標、圍標或借牌等行為。',
    '政府採購法:88': '處罰受託規劃、設計、專案管理、代辦採購或供應廠商違法綁標、限制競爭等行為。',
    '政府採購法:92': '廠商從業人員因執行業務犯採購法之罪時，除處罰行為人外，亦對廠商科罰金。',
    '政府採購法:93-1': '採購得以電子化方式辦理，電子化資料視同正式文件。',
    '政府採購法:94': '評選應成立五人以上委員會，專家學者不得少於三分之一。',
    '政府採購法:101': '列舉機關得通知廠商並刊登政府採購公報的違法或重大違約情形。',
    '政府採購法:102': '規範廠商對第101條通知提出異議及機關處理程序。',
    '政府採購法:103': '規範拒絕往來期間及刊登後的投標限制。',
    '政府採購法施行細則:6': '採購金額在招標前認定，並依分批、複數決標、後續擴充、選購或租期等方式計算。',
    '政府採購法施行細則:22': '補充採購法第22條限制性招標事由及追加契約金額的計算。',
    '政府採購法施行細則:26': '補充招標公告及文件修正時的等標期處理。',
    '政府採購法施行細則:38': '規範投標文件的補正及其限制。',
    '政府採購法施行細則:54': '規範合格投標廠商家數、開標及流標等程序細節。',
    '政府採購法施行細則:64': '補充最低標超過底價時的減價、比減價及決標程序。',
    '政府採購法施行細則:79': '補充履約管理及契約變更相關程序。',
    '政府採購法施行細則:84': '規範機關辦理驗收的主驗、會驗及協驗人員。',
    '政府採購法施行細則:90': '規範驗收不符時改善、重作、退換貨或減價收受的處理。',
    '政府採購法施行細則:92': '規範竣工、初驗及驗收前應辦事項與紀錄。'
  };

  const rules = [
    { re: /追加累計金額|加帳部分|減帳部分|原主契約金額/, focus: '追加金額的計算範圍，以及加帳、減帳是否納入分子', refs: [['政府採購法施行細則', '22', '第4項']], exclusive: true },
    { re: /補助.*(半數|二分之一|公告金額)|接受機關補助/, focus: '補助金額占比、補助金額是否達公告金額及監督機關', refs: [['政府採購法', '4']] },
    { re: /代辦採購|委託.*代辦/, focus: '受託代辦的法律地位、採購法適用及委託機關監督', refs: [['政府採購法', '5'], ['政府採購法施行細則', '4']] },
    { re: /分批|規避.*採購法/, focus: '是否意圖規避及是否應以總金額核計', refs: [['政府採購法', '14'], ['政府採購法施行細則', '6']] },
    { re: /利益衝突|應行迴避|請託|關說|離職後/, focus: '採購人員利益衝突、迴避及請託關說紀錄', refs: [['政府採購法', '15']] },
    { re: /公開招標|選擇性招標|限制性招標|招標方式/, focus: '採購金額、法定招標方式及例外事由', refs: [['政府採購法', '18'], ['政府採購法', '19'], ['政府採購法', '22']] },
    { re: /未達公告金額|公開取得.*(報價|企劃書)|小額採購/, focus: '採購金額級距及未達公告金額案件的法定程序', refs: [['政府採購法', '23'], ['中央機關未達公告金額採購招標辦法', '2'], ['中央機關未達公告金額採購招標辦法', '5']] },
    { re: /統包/, focus: '是否將設計與施工、供應、安裝或維修併於同一契約', refs: [['政府採購法', '24']] },
    { re: /共同投標|共同投標協議書/, focus: '招標文件是否允許、成員共同具名及連帶履約責任', refs: [['政府採購法', '25'], ['共同投標辦法', '4']] },
    { re: /同等品|商標|商名|專利|技術規格|限制競爭|特定廠牌/, focus: '規格是否依功能效益訂定及是否造成不當限制競爭', refs: [['政府採購法', '26']] },
    { re: /等標期|截止投標|延長.*期限|縮短.*期限/, focus: '招標方式、公告級距、是否修正文件及合理等標期限', refs: [['政府採購法', '28'], ['招標期限標準', '2']] },
    { re: /領標|招標文件.*(發售|公開)|不得登記/, focus: '招標文件公開提供及領標廠商資訊保護', refs: [['政府採購法', '29']] },
    { re: /押標金|履約保證金|保固保證金|保證金|擔保信用狀|連帶保證/, focus: '擔保種類、額度、免收事由、不發還或追繳要件', refs: [['政府採購法', '30'], ['政府採購法', '31'], ['政府採購法', '32'], ['押標金保證金暨其他擔保作業辦法', '9']] },
    { re: /投標文件.*(補正|密封|送達)|補正.*文件/, focus: '文件是否屬非契約必要之點、補正時點及公平性', refs: [['政府採購法', '33'], ['政府採購法施行細則', '38']] },
    { re: /底價.*保密|領標.*家數|投標廠商.*名稱|招標文件.*保密/, focus: '開標前保密範圍與決標後底價公開原則', refs: [['政府採購法', '34']] },
    { re: /基本資格|特定資格|特殊採購|巨額採購|廠商資格/, focus: '資格是否為履約所必須及有無不當限制競爭', refs: [['政府採購法', '36'], ['政府採購法', '37'], ['投標廠商資格與特殊或巨額採購認定標準', '2']] },
    { re: /專案管理|受其管理之標案|關係企業/, focus: '專案管理廠商的獨立性及利益衝突限制', refs: [['政府採購法', '39']] },
    { re: /釋疑|疑義|變更.*招標文件/, focus: '釋疑期限、書面答復、公告變更及是否延長等標期', refs: [['政府採購法', '41']] },
    { re: /底價|價格分析|成本分析|市場行情/, focus: '底價是否依法逐項編列、核定及其訂定時點', refs: [['政府採購法', '46'], ['政府採購法', '47']] },
    { re: /三家以上|家數不足|一家廠商|流標|開標家數/, focus: '招標次數、合格廠商家數及法定例外', refs: [['政府採購法', '48'], ['政府採購法施行細則', '54']] },
    { re: /不予開標|不予決標|借用.*名義|借牌|圍標/, focus: '投標文件異常、影響採購公正或不法投標行為', refs: [['政府採購法', '50'], ['政府採購法', '87']] },
    { re: /最低標|超底價|減價|比減價|標價偏低|顯不合理/, focus: '決標原則、底價、減價程序及低價履約風險', refs: [['政府採購法', '52'], ['政府採購法', '53'], ['政府採購法', '58']] },
    { re: /最有利標|評選優勝|序位法|總評分法|評分及格最低標/, focus: '評選項目、配分、評定方式及決標程序須與招標文件一致', refs: [['政府採購法', '56'], ['最有利標評選辦法', '6'], ['最有利標評選辦法', '12']] },
    { re: /評選委員|委員會|專家學者|工作小組|出席委員/, focus: '委員人數、專家學者比例、出席與迴避', refs: [['政府採購法', '94'], ['採購評選委員會組織準則', '4'], ['採購評選委員會審議規則', '6']] },
    { re: /契約範本|契約條款|契約變更|履約期限|逾期違約金|付款期限/, focus: '契約約定、變更程序、履約期限及違約責任', refs: [['政府採購法', '63'], ['採購契約要項', '20']] },
    { re: /轉包|分包/, focus: '是合法分包或違法轉包，以及得標廠商的履約責任', refs: [['政府採購法', '65'], ['政府採購法', '67']] },
    { re: /品質管理|施工查核|監造|分段查驗/, focus: '品質管理、檢查程序、監造責任及分段查驗', refs: [['政府採購法', '70']] },
    { re: /驗收|初驗|竣工|減價收受|複驗|結算驗收證明書/, focus: '驗收人員、驗收結果、不符處理及結算驗收證明', refs: [['政府採購法', '71'], ['政府採購法', '72'], ['政府採購法', '73'], ['政府採購法施行細則', '84'], ['政府採購法施行細則', '90']] },
    { re: /異議|申訴|調解|仲裁|履約爭議/, focus: '爭議類型、提出期間、受理機關及救濟程序', refs: [['政府採購法', '74'], ['政府採購法', '75'], ['政府採購法', '76'], ['政府採購法', '85-1'], ['採購申訴審議規則', '4']] },
    { re: /不良廠商|拒絕往來|刊登政府採購公報|第101條/, focus: '通知事由、異議程序及拒絕往來期間', refs: [['政府採購法', '101'], ['政府採購法', '102'], ['政府採購法', '103']] },
    { re: /電子領標|電子投標|電子採購|電子化/, focus: '電子資料效力、電子領投標及系統作業程序', refs: [['政府採購法', '93-1'], ['電子採購作業辦法', '3']] },
    { re: /技術服務|建造費用百分比|服務成本加公費|設計服務|監造服務/, focus: '技術服務範圍、評選方式、計費基礎及專業責任', refs: [['政府採購法', '22', '第1項第9款'], ['機關委託技術服務廠商評選及計費辦法', '2'], ['機關委託技術服務廠商評選及計費辦法', '25']] },
    { re: /專業服務/, focus: '專業服務公開評選及計費方式', refs: [['政府採購法', '22', '第1項第9款'], ['機關委託專業服務廠商評選及計費辦法', '2']] },
    { re: /資訊服務/, focus: '資訊服務公開評選、計費、交付成果及資安責任', refs: [['政府採購法', '22', '第1項第9款'], ['機關委託資訊服務廠商評選及計費辦法', '2']] },
    { re: /社會福利服務/, focus: '社會福利服務評選、計費及服務品質', refs: [['政府採購法', '22', '第1項第9款'], ['機關委託社會福利服務廠商評選及計費辦法', '2']] },
    { re: /刑責|罰則|行賄|綁標|洩漏|圍標|借牌|不正利益/, focus: '行為人的主觀故意、行為態樣及採購法刑事責任', refs: [['政府採購法', '87'], ['政府採購法', '88'], ['政府採購法', '92']] }
  ];

  const aliasPairs = Object.entries(catalog)
    .flatMap(([official, item]) => item.aliases.map((alias) => ({ official, alias })))
    .sort((a, b) => b.alias.length - a.alias.length);

  const analysisCache = new Map();

  function normalizedName(raw) {
    const name = String(raw || '').replace(/政府採購法規定/g, '政府採購法').trim();
    const exact = aliasPairs.find((item) => item.alias === name);
    if (exact) return exact.official;
    const contained = aliasPairs.find((item) => name.includes(item.alias));
    return contained?.official || name;
  }

  function chineseToInt(raw) {
    const text = String(raw || '').replace(/[零〇]/g, '零').replace(/兩/g, '二');
    if (!text) return NaN;
    if (/^\d+$/.test(text)) return Number(text);
    const digit = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    const unit = { 十: 10, 百: 100, 千: 1000 };
    let total = 0;
    let current = 0;
    for (const char of text) {
      if (Object.prototype.hasOwnProperty.call(digit, char)) {
        current = digit[char];
      } else if (unit[char]) {
        total += (current || 1) * unit[char];
        current = 0;
      } else {
        return NaN;
      }
    }
    return total + current;
  }

  function normalizeArticleToken(raw) {
    const token = String(raw || '').replace(/\s+/g, '').replace(/之/g, '-');
    const parts = token.split('-').filter(Boolean);
    if (!parts.length) return '';
    const converted = parts.map((part) => /^\d+$/.test(part) ? Number(part) : chineseToInt(part));
    if (converted.some((value) => !Number.isFinite(value))) return '';
    return converted.join('-');
  }

  function lawUrl(name, article = '') {
    const item = { ...(catalog[name] || {}), ...(VERIFIED.laws?.[name] || {}) };
    if (item?.pcode) {
      return article
        ? `${LAW_BASE}/LawClass/LawSingle.aspx?pcode=${item.pcode}&flno=${encodeURIComponent(article)}`
        : `${LAW_BASE}/LawClass/LawAll.aspx?pcode=${item.pcode}`;
    }
    return `${LAW_BASE}/Law/LawSearchResult.aspx?ty=ONEBAR&kw=${encodeURIComponent(name + (article ? ` 第${article}條` : ''))}`;
  }

  function sourceUrl(source = '') {
    const text = String(source);
    if (/契約範本|投標須知|表格|保證文件/.test(text)) return `${PCC_BASE}/content/index?eid=9808&type=C`;
    if (/錯誤.*態樣/.test(text)) return `${PCC_BASE}/content/index?eid=1537&type=C`;
    if (/題庫|課程|教材/.test(text)) return `${PCC_BASE}/content/cp.aspx?n=FD23B22B41E75687`;
    if (/解釋函|函釋/.test(text)) return `${PCC_BASE}/content/list?eid=9950`;
    return `${PCC_BASE}/content/index?eid=9936&type=C`;
  }

  function relationRank(origin) {
    if (origin === '題庫已驗證法源') return 0;
    if (origin === '題目明示法源') return 1;
    if (origin === '補充參考法源') return 2;
    if (origin === '關鍵字推定法源') return 3;
    return 4;
  }

  function addReference(refs, name, article = '', detail = '', origin = '題目明示法源') {
    const lawName = normalizedName(name);
    if (!lawName) return;
    const articleNo = normalizeArticleToken(String(article || '').replace(/^第|條$/g, '').trim()) || String(article || '').replace(/^第|條$/g, '').trim();
    const cleanDetail = String(detail || '').replace(/\s+/g, '');
    const key = `${lawName}:${articleNo}:${cleanDetail}`;
    const existing = refs.find((ref) => ref.key === key);
    if (existing) {
      if (relationRank(origin) < relationRank(existing.origin)) existing.origin = origin;
      return;
    }
    const summaryKey = `${lawName}:${articleNo}`;
    const lawMeta = { ...(catalog[lawName] || {}), ...(VERIFIED.laws?.[lawName] || {}) };
    refs.push({
      key,
      name: lawName,
      article: articleNo,
      detail: cleanDetail,
      label: articleNo ? `${lawName}第${articleNo}條${cleanDetail || ''}` : lawName,
      summary: articleSummary[summaryKey] || lawMeta.summary || '目前僅能提供法規範圍，請開啟官方最新全文核對條文內容與適用要件。',
      url: lawUrl(lawName, articleNo),
      origin,
      revisionDate: lawMeta.revisionDate || '',
      verifiedSummary: VERIFIED_ARTICLES.has(summaryKey),
      verifiedAt: VERIFIED_ARTICLES.has(summaryKey) ? (VERIFIED.verifiedAtLabel || DATA_AS_OF_LABEL) : ''
    });
  }

  function extractStructured(question) {
    const refs = [];
    const rows = Array.isArray(question?.legalBasis) ? question.legalBasis : [];
    rows.forEach((row) => {
      if (!row || typeof row !== 'object') return;
      const detail = `${row.paragraph || ''}${row.subparagraph || ''}`;
      addReference(refs, row.law || row.name, row.article || '', detail, '題庫已驗證法源');
      if (row.verified === true) {
        const latest = refs[refs.length - 1];
        if (latest) latest.questionRelationVerified = true;
      }
    });
    return refs;
  }

  function extractExplicit(text) {
    const refs = [];
    const aliasMap = new Map(aliasPairs.map((item) => [item.alias, item.official]));
    const pattern = aliasPairs.map((item) => item.alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const numberToken = '[0-9一二三四五六七八九十百千零〇兩]+(?:[-之][0-9一二三四五六七八九十百千零〇兩]+)?';
    const regex = new RegExp(`(${pattern})\\s*第\\s*(${numberToken})\\s*條(?:\\s*第\\s*(${numberToken})\\s*項)?(?:\\s*第\\s*(${numberToken})\\s*款)?`, 'g');
    let match;
    while ((match = regex.exec(text))) {
      const article = normalizeArticleToken(match[2]);
      const paragraph = normalizeArticleToken(match[3]);
      const subparagraph = normalizeArticleToken(match[4]);
      const detail = `${paragraph ? `第${paragraph}項` : ''}${subparagraph ? `第${subparagraph}款` : ''}`;
      addReference(refs, aliasMap.get(match[1]) || match[1], article, detail, '題目明示法源');
    }
    return refs;
  }

  function questionCacheKey(question) {
    return `${question?.id || ''}|${question?.question || ''}|${question?.explanation || ''}`;
  }

  function infer(question) {
    const cacheKey = questionCacheKey(question);
    if (analysisCache.has(cacheKey)) return analysisCache.get(cacheKey);
    const explicitText = `${question.question || ''} ${(question.options || []).join(' ')} ${question.explanation || ''}`.replace(/\s+/g, ' ');
    const ruleText = `${question.question || ''} ${(question.options || []).join(' ')}`.replace(/\s+/g, ' ');
    const refs = [...extractStructured(question), ...extractExplicit(explicitText)];
    const hasDirect = refs.some((ref) => ref.origin === '題庫已驗證法源' || ref.origin === '題目明示法源');
    let focus = '';
    let matchedRules = 0;
    for (const rule of rules) {
      rule.re.lastIndex = 0;
      if (!rule.re.test(ruleText)) continue;
      if (!focus) focus = rule.focus;
      const origin = hasDirect ? '補充參考法源' : '關鍵字推定法源';
      rule.refs.forEach(([name, article, detail]) => addReference(refs, name, article, detail || '', origin));
      matchedRules += 1;
      if (rule.exclusive || matchedRules >= (hasDirect ? 1 : 3)) break;
    }

    if (!refs.length) {
      const defaults = {
        '政府採購法之總則、招標及決標': [['政府採購法', '6'], ['政府採購法', '18'], ['政府採購法', '52']],
        '政府採購法之履約管理及驗收': [['政府採購法', '63'], ['政府採購法', '71'], ['政府採購法', '72']],
        '政府採購法之爭議處理': [['政府採購法', '74'], ['政府採購法', '75'], ['政府採購法', '85-1']],
        '政府採購法之罰則及附則': [['政府採購法', '87'], ['政府採購法', '92']],
        '最有利標及評選優勝廠商': [['政府採購法', '56'], ['政府採購法', '94'], ['最有利標評選辦法', '6']],
        '工程及技術服務採購作業': [['政府採購法', '22', '第1項第9款'], ['機關委託技術服務廠商評選及計費辦法', '2']],
        '電子採購實務': [['政府採購法', '93-1'], ['電子採購作業辦法', '3']],
        '採購契約': [['政府採購法', '63'], ['採購契約要項', '20']],
        '契約範本實務': [['政府採購法', '63']],
        '錯誤採購態樣': [['政府採購法', '6'], ['政府採購法', '26'], ['政府採購法', '37']],
        '財物及勞務採購作業': [['政府採購法', '7'], ['政府採購法', '18'], ['政府採購法', '52']],
        '投標須知及招標文件製作': [['政府採購法', '29'], ['政府採購法', '33'], ['政府採購法', '41']],
        '投標須知與招標文件範本': [['政府採購法', '29'], ['政府採購法', '33'], ['政府採購法', '41']],
        '底價及價格分析': [['政府採購法', '46'], ['政府採購法', '47'], ['政府採購法', '53']],
        '道德規範及違法處置': [['政府採購法', '6'], ['政府採購法', '15'], ['政府採購法', '87']],
        '政府採購全生命週期概論': [['政府採購法', '6'], ['政府採購法', '18'], ['政府採購法', '63'], ['政府採購法', '71']],
        '採購表格與保證文件': [['政府採購法', '30'], ['政府採購法', '31'], ['政府採購法', '73']]
      };
      (defaults[question.section] || []).forEach(([name, article, detail]) => addReference(refs, name, article, detail || '', '科目範圍（非確定條號）'));
      focus = focus || '題目所屬採購階段、金額級距、法定原則及例外要件';
    }

    refs.sort((a, b) => relationRank(a.origin) - relationRank(b.origin) || a.label.localeCompare(b.label, 'zh-Hant'));
    const result = { refs: refs.slice(0, 8), focus: focus || '題目中的法定要件、程序階段及例外規定' };
    analysisCache.set(cacheKey, result);
    return result;
  }

  function isNegativeStem(text) {
    return /何者(?:為)?(?:錯誤|不正確|不適當|不屬於|非)|下列.*(?:錯誤|不正確|不屬於)|何者不得|何者不應|何者非/.test(String(text || ''));
  }

  function optionReason(question, option, index, selectedIndex, focus, primaryRef) {
    const correct = index === question.answer;
    const selected = index === selectedIndex;
    const negative = isNegativeStem(question.question);
    const absolute = /一律|均應|任何|絕對|必然|完全|不得例外|皆不得|全部/.test(String(option || ''));
    if (correct) {
      return negative
        ? '本題為反向題；此選項是題庫指定的「不符合規定、錯誤或例外」項目。作答時應先圈出題幹中的否定語。'
        : `此選項符合題目要求，為題庫指定正確答案。${primaryRef ? `可優先對照${primaryRef.label}的核心規則：「${primaryRef.summary}」` : '請再以主要法源的適用對象、程序階段及例外規定核對。'}`;
    }
    const selectedPrefix = selected ? '你選擇了此項，但它不是題庫指定答案。' : '此項不是題庫指定答案。';
    const caution = absolute ? '此選項使用較絕對的用語，常見風險是忽略法定例外或前提。' : '';
    return `${selectedPrefix}${caution}${primaryRef ? `請對照${primaryRef.label}的核心規則：「${primaryRef.summary}」並檢查題幹前提。` : `現有題庫未提供此選項的逐項官方理由，平台不臆測具體錯因；請對照「${focus}」及下列主要法源確認。`}`;
  }

  function getAnalysis(question, selectedIndex, context = 'browse') {
    const correctText = question.options?.[question.answer] ?? '';
    const hasSelectedAnswer = Number.isInteger(selectedIndex) && selectedIndex >= 0 && selectedIndex < (question.options?.length || 0);
    const selectedText = hasSelectedAnswer ? question.options[selectedIndex] : '';
    const { refs, focus } = infer(question);
    const wrong = hasSelectedAnswer && selectedIndex !== question.answer;
    const unanswered = context === 'review' && !hasSelectedAnswer;
    const source = String(question.source || '題庫未標示原始來源').replace(/\s+/g, ' ').trim();
    const original = String(question.explanation || '').replace(/\s+/g, ' ').trim();
    const primaryVerified = refs.find((ref) => ref.verifiedSummary);
    const genericExplanation = /判斷時應先辨識|本題判定為|官方答案為第/.test(original);
    const reason = primaryVerified && genericExplanation
      ? `題庫答案為「${correctText}」。本題可優先對照${primaryVerified.label}：${primaryVerified.summary}；再依題幹中的適用對象、程序階段、金額門檻與例外條件判斷。`
      : (original || `正確答案為「${correctText}」。現有題庫未提供更完整的官方逐題說明，請依「${focus}」與主要法源進一步核對。`);
    let wrongReason = '';
    if (wrong) {
      wrongReason = `你選擇「${selectedText}」，題庫答案為「${correctText}」。應重新檢查「${focus}」；若下方法源標示為推定或科目範圍，不應直接視為本題唯一法條。`;
    } else if (unanswered) {
      wrongReason = `本題未作答，題庫答案為「${correctText}」。建議先辨識題幹是正向題或反向題，再依「${focus}」判讀。`;
    }
    const direct = refs.filter((ref) => ['題庫已驗證法源', '題目明示法源'].includes(ref.origin));
    const confidence = direct.some((ref) => ref.origin === '題庫已驗證法源')
      ? '題庫已驗證'
      : direct.length ? '題目明示' : refs.some((ref) => ref.origin === '關鍵字推定法源') ? '關鍵字推定' : '科目範圍';
    const optionAnalysis = (question.options || []).map((option, index) => ({
      index,
      text: option,
      correct: index === question.answer,
      selected: index === selectedIndex,
      reason: optionReason(question, option, index, selectedIndex, focus, primaryVerified)
    }));
    return {
      correctText,
      selectedText,
      wrong,
      unanswered,
      reason,
      wrongReason,
      focus,
      refs,
      optionAnalysis,
      source,
      sourceUrl: sourceUrl(source),
      confidence,
      dataAsOf: DATA_AS_OF,
      dataAsOfLabel: DATA_AS_OF_LABEL
    };
  }

  function buildIndex(questions) {
    const map = new Map();
    (Array.isArray(questions) ? questions : []).forEach((question) => {
      const { refs } = infer(question);
      refs.forEach((ref) => {
        if (ref.origin === '科目範圍（非確定條號）') return;
        if (!map.has(ref.key)) map.set(ref.key, { ...ref, questionIds: [], directQuestionIds: [], inferredQuestionIds: [], directCount: 0, inferredCount: 0 });
        const entry = map.get(ref.key);
        entry.questionIds.push(question.id);
        if (['題庫已驗證法源', '題目明示法源'].includes(ref.origin)) { entry.directCount += 1; entry.directQuestionIds.push(question.id); }
        else { entry.inferredCount += 1; entry.inferredQuestionIds.push(question.id); }
      });
    });
    return [...map.values()].sort((a, b) => b.questionIds.length - a.questionIds.length || a.label.localeCompare(b.label, 'zh-Hant'));
  }

  function audit(questions) {
    const result = { total: 0, questionVerified: 0, explicit: 0, inferredOnly: 0, scopeOnly: 0, withVerifiedArticleSummary: 0, verifiedArticleKeys: VERIFIED_ARTICLES.size };
    (Array.isArray(questions) ? questions : []).forEach((question) => {
      result.total += 1;
      const refs = infer(question).refs;
      if (refs.some((ref) => ref.origin === '題庫已驗證法源')) result.questionVerified += 1;
      else if (refs.some((ref) => ref.origin === '題目明示法源')) result.explicit += 1;
      else if (refs.some((ref) => ref.origin === '關鍵字推定法源')) result.inferredOnly += 1;
      else result.scopeOnly += 1;
      if (refs.some((ref) => ref.verifiedSummary)) result.withVerifiedArticleSummary += 1;
    });
    return result;
  }

  window.LEGAL_ANALYSIS = Object.freeze({
    getAnalysis,
    infer,
    buildIndex,
    audit,
    lawUrl,
    sourceUrl,
    DATA_AS_OF,
    DATA_AS_OF_LABEL,
    VERIFICATION: VERIFIED
  });
})();
