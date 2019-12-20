import Component from '@ember/component';
import layout from './template';
import { get, computed, setProperties, set } from '@ember/object';
import { inject as service } from '@ember/service';
import CrudCatalog from 'shared/mixins/crud-catalog';
import { convertToMillis } from 'shared/utils/util';
import { parseSi } from 'shared/utils/parse-unit'
import ReservationCheck from 'shared/mixins/reservation-check';
import CatalogUpgrade from 'shared/mixins/catalog-upgrade';
import C from 'ui/utils/constants';

const THANOS_QUERY_REQUEST_CPU = 'thanos.resources.thanos.requests.cpu'
const THANOS_QUERY_REQUEST_MEM = 'thanos.resources.thanos.requests.memory'
const THANOS_QUERY_LIMIT_CPU = 'thanos.resources.thanos.limits.cpu'
const THANOS_QUERY_LIMIT_MEM = 'thanos.resources.thanos.limits.memory'
const THANOS_QUERY_NODE_SELECTOR_PREFIX = 'thanos.nodeSelector.'
const THANOS_QUERY_TOLERATION = 'thanos.tolerations'

const GRAFANA_REQUEST_CPU = 'grafana.resources.core.requests.cpu'
const GRAFANA_REQUEST_MEM = 'grafana.resources.core.requests.memory'
const GRAFANA_LIMIT_CPU = 'grafana.resources.core.limits.cpu'
const GRAFANA_LIMIT_MEM = 'grafana.resources.core.limits.memory'
const GRAFANA_NODE_SELECTOR_PREFIX = 'grafana.nodeSelector.'
const GRAFANA_TOLERATION = 'grafana.tolerations'
const GRAFANA_PV_ENABLED = 'grafana.persistence.enabled'
const GRAFANA_DASHBOARD = 'grafana.sidecar.dashboards.enabled'
const GRAFANA_PV_SIZE = 'grafana.persistence.size'
const GRAFANA_SC = 'grafana.persistence.storageClass'

const DASHBOARD_UI_NODE_SELECTOR_PREFIX = 'ui.nodeSelector.'
const DASHBOARD_UI_TOLERATION = 'ui.tolerations'

const ANSWER_TO_CONFIG = {
  [THANOS_QUERY_REQUEST_CPU]: 'thanosRequestCpu',
  [THANOS_QUERY_REQUEST_MEM]: 'thanosRequestMemory',
  [THANOS_QUERY_LIMIT_MEM]:   'thanosLimitMemory',
  [THANOS_QUERY_LIMIT_CPU]:   'thanosLimitCpu',
  [GRAFANA_REQUEST_CPU]:      'grafanaRequestCpu',
  [GRAFANA_REQUEST_MEM]:      'grafanaRequestMemory',
  [GRAFANA_LIMIT_MEM]:        'grafanaLimitMemory',
  [GRAFANA_LIMIT_CPU]:        'grafanaLimitCpu',
  [GRAFANA_PV_ENABLED]:       'enableGrafanaPersistence',
  [GRAFANA_DASHBOARD]:        'enableGrafanaSidecar',
  [GRAFANA_PV_SIZE]:          'grafanaPersistenceSize',
  [GRAFANA_SC]:               'grafanaStorageClass',
}

const HIDDEN_KEYS = ['clusterIds', 'rancherHostname', 'token']

const WORKLOADS = ['thanos', 'grafana']
const APP_NAME = 'global-monitoring';
const APP_NAMESPACE = 'cattle-global-data';
const APP_TEMPLATE_NAME = 'thanos'
const APP_TEMPLATE = 'system-library-thanos';
const GLOBAL_MONITORING_SVC = 'access-dashboard';
const GRAFANA_SVC = 'access-grafana';
const THANOS_SVC = 'access-thanos';
const DEFAULT_MIN_MEMORY = 512;
const WARNING_PREFIX = 'globalMonitoringPage.insufficientSize.total'

export default Component.extend(CrudCatalog, ReservationCheck, CatalogUpgrade, {
  scope:        service(),
  intl:         service(),

  layout,

  answers:      null,
  appName:      APP_NAME,
  nsName:       APP_NAMESPACE,
  templateId:   APP_TEMPLATE,
  templateName: APP_TEMPLATE_NAME,
  updatingApp:  true,

  projectLevelMinMemory: DEFAULT_MIN_MEMORY,
  warningPrefix:         WARNING_PREFIX,

  cluster: null,

  init() {
    this._super(...arguments);

    this.initConfig();
    this.initWorkloads();

    if ( this.enabled ) {
      this.initAnswers();
    }
  },

  actions: {
    save(cb) {
      set(this, 'errors', [])
      const errors = this.validate() || []

      if (errors.length > 0) {
        set(this, 'errors', errors)
        cb()

        return
      }

      let answers = {};

      HIDDEN_KEYS.forEach((key) => {
        const ans = get(this, 'app.answers') || {};

        if ( ans[key] ) {
          answers[key] = ans[key];
        }
      })

      const answerKeys = Object.keys(ANSWER_TO_CONFIG) || []

      answerKeys.map((key) => {
        const value = get(this, `config.${ ANSWER_TO_CONFIG[key] }`)

        if ( value === undefined || value === '' ) {
          return;
        }

        switch (key) {
        case THANOS_QUERY_REQUEST_CPU:
        case THANOS_QUERY_LIMIT_CPU:
        case GRAFANA_REQUEST_CPU:
        case GRAFANA_LIMIT_CPU:
          answers[key] = `${ value }m`
          break;
        case THANOS_QUERY_REQUEST_MEM:
        case THANOS_QUERY_LIMIT_MEM:
        case GRAFANA_REQUEST_MEM:
        case GRAFANA_LIMIT_MEM:
          answers[key] = `${ value }Mi`
          break;
        case GRAFANA_PV_ENABLED:
        case GRAFANA_DASHBOARD:
          answers[key] = `${ value }`;
          break;
        case GRAFANA_SC:
          answers[key] =  `${ value === null ? 'default' : value }`;
          break;
        default:
          answers[key] = value
        }
      });

      WORKLOADS.map((component) => {
        (get(this, `${ component }Tolerations`) || []).map((t, index) => {
          Object.keys(t).map((key) => {
            if (t[key]) {
              answers[`${ component }.tolerations[${ index }].${ key }`] = t[key]
              if ( component === 'thanos' ) {
                answers[`ui.tolerations[${ index }].${ key }`] = t[key]
              }
            }
          })
        });
      });

      WORKLOADS.map((component) => {
        (get(this, `${ component }NodeSelectors`) || []).map((selector) => {
          let { key, value } = selector

          if (key.includes('.')) {
            key = key.replace(/\./g, '\\.')
          }
          answers[`${ component }.nodeSelector.${ key }`] = value
          if ( component === 'thanos' ) {
            answers[`ui.nodeSelector.${ key }`] = value
          }
        });
      })

      this.save(cb, answers);
      if ( !this.enabled ) {
        this.setGlobalMonitoringEnabledSetting(true);
        this.updatingApp = false;
      } else {
        this.updatingApp = true;
      }
    },

    disable() {
      this._super();
      this.setGlobalMonitoringEnabledSetting(false);
    },
  },

  globalMonitoringUrl: computed('cluster.id', function() {
    return `/k8s/clusters/${ this.cluster.id }/api/v1/namespaces/${ APP_NAMESPACE }/services/http:${ GLOBAL_MONITORING_SVC }:80/proxy/`
  }),

  grafanaUrl: computed('cluster.id', function() {
    return `/k8s/clusters/${ this.cluster.id }/api/v1/namespaces/${ APP_NAMESPACE }/services/http:${ GRAFANA_SVC }:80/proxy/`
  }),

  thanosUrl: computed('cluster.id', function() {
    return `/k8s/clusters/${ this.cluster.id }/api/v1/namespaces/${ APP_NAMESPACE }/services/http:${ THANOS_SVC }:80/proxy/`
  }),

  saveDisabled: computed('enabled', 'grafanaWarning', 'thanosWarning', 'totalWarning', function() {
    return [...WORKLOADS].reduce((out, w) => out || (get(this, `${ w }Warning`) || false), false) || this.totalWarning
  }),

  enabled: computed('app.state', function() {
    return !!this.app && this.app.state !== 'removing'
  }),

  requestsCpu: computed('config.thanosRequestCpu', 'config.grafanaRequestCpu', function() {
    return WORKLOADS.reduce((all, w) => {
      return all + parseInt(get(this, `config.${ w }RequestCpu`) || 0)
    }, 0)
  }),

  requestsMemory: computed('config.thanosRequestMemory', 'config.grafanaRequestMemory', function() {
    return WORKLOADS.reduce((all, w) => {
      return all + parseInt(get(this, `config.${ w }RequestMemory`) || 0)
    }, 0)
  }),

  chartVersions: computed('availableVersions', 'templateLables', function() {
    const { availableVersions = [], templateLables = {} } = this

    return availableVersions.map((v) => {
      const key = `rancher.thanos.v${ v.value }`

      return {
        label: `${ v.label } (Thanos ${ templateLables[key] })`,
        value: v.value,
      }
    })
  }),

  initConfig() {
    const config = {
      thanosRequestCpu:         100,
      thanosRequestMemory:      256,
      thanosLimitCpu:           300,
      thanosLimitMemory:        512,
      grafanaRequestCpu:        100,
      grafanaRequestMemory:     256,
      grafanaLimitCpu:          300,
      grafanaLimitMemory:       512,
      enableGrafanaPersistence: false,
      enableGrafanaSidecar:     false,
      grafanaPersistenceSize:   '10Gi',
      grafanaStorageClass:      null,
    }

    set(this, 'config', config);
  },

  initAnswers() {
    let customAnswers = {};

    const answers = get(this, 'app.answers') || {};
    const answerKeys = Object.keys(ANSWER_TO_CONFIG) || []

    this.initSelectorsAndTolerations(answers, 'thanos', THANOS_QUERY_NODE_SELECTOR_PREFIX, THANOS_QUERY_TOLERATION);
    this.initSelectorsAndTolerations(answers, 'grafana', GRAFANA_NODE_SELECTOR_PREFIX, GRAFANA_TOLERATION);

    this.updateCpuMemoryPreRequest()

    Object.keys(answers).forEach((key = '') => {
      if (key.startsWith(THANOS_QUERY_NODE_SELECTOR_PREFIX)
          || key.startsWith(`${ THANOS_QUERY_TOLERATION }`)
      ) {
        return
      }

      if (key.startsWith(GRAFANA_NODE_SELECTOR_PREFIX)
      || key.startsWith(`${ GRAFANA_TOLERATION }`)
      ) {
        return
      }

      if (key.startsWith(DASHBOARD_UI_NODE_SELECTOR_PREFIX)
      || key.startsWith(`${ DASHBOARD_UI_TOLERATION }`)
      ) {
        return
      }

      if (HIDDEN_KEYS.includes(key)) {
        return
      }

      if (answerKeys.includes(key)) {
        let value

        switch (key) {
        case THANOS_QUERY_REQUEST_CPU:
        case THANOS_QUERY_LIMIT_CPU:
        case GRAFANA_REQUEST_CPU:
        case GRAFANA_LIMIT_CPU:
          value = convertToMillis(answers[key] || '0')
          break;
        case THANOS_QUERY_REQUEST_MEM:
        case THANOS_QUERY_LIMIT_MEM:
        case GRAFANA_REQUEST_MEM:
        case GRAFANA_LIMIT_MEM:
          value = parseSi(answers[key] || '0', 1024) / 1048576
          break;
        case GRAFANA_PV_ENABLED:
        case GRAFANA_DASHBOARD:
          value = answers[key] === 'true';
          break;
        case GRAFANA_SC:
          value = answers[key] === 'default' ? null : answers[key]
          break;
        default:
          value = answers[key]
        }

        return set(this, `config.${ ANSWER_TO_CONFIG[key] }`, value)
      }

      customAnswers[key] = answers[key];
      setProperties(this, { customAnswers, })
    });
  },

  getEnalbedWorkloads() {
    return WORKLOADS;
  },

  doneSaving() {
    this.updateCpuMemoryPreRequest()
  },

  setGlobalMonitoringEnabledSetting(value) {
    const enabled = this.globalStore.all('setting').findBy('id', C.SETTING.GLOBAL_MONITORING_ENABLED)

    set(enabled, 'value', value)
    enabled.save();
  },
});
