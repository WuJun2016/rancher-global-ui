import Route from '@ember/routing/route';
import { inject as service } from '@ember/service';
import { all as PromiseAll } from 'rsvp';

const NAME = 'global-monitoring';
const NAMESPACE_NAME = 'cattle-global-data';

export default Route.extend({
  globalStore: service(),

  model() {
    const clusters = this.globalStore.all('cluster');
    const adminClusterId = this.globalStore.all('setting').findBy('id', 'admin-cluster-id') || {};
    const cluster = clusters.findBy('id', adminClusterId.value);

    if ( !cluster ) {
      return { adminClusterDefined: false }
    }

    const project = cluster.systemProject;
    const apps = project.followLink('apps');
    const namespaces = cluster.followLink('namespaces');
    const storageClasses = cluster.followLink('storageClasses');
    const persistentVolumeClaims = project.followLink('persistentVolumeClaims')

    return PromiseAll([apps, namespaces, storageClasses, persistentVolumeClaims]).then((data) => {
      const apps = data[0] || [];
      const namespaces = data[1] || [];
      const storageClasses = data[2] || []
      const persistentVolumeClaims = data[3] || []
      const namespace = namespaces.findBy('name', NAMESPACE_NAME);

      return {
        app:                    apps.findBy('name', NAME),
        nsExists:               !!namespace,
        cluster,
        project,
        storageClasses,
        namespace,
        persistentVolumeClaims: persistentVolumeClaims.filter((p) => p.namespaceId === NAMESPACE_NAME && p.state === 'bound'),
        adminClusterDefined:    true
      }
    }).catch(() => {
      return { adminClusterUnavailable: true }
    });
  },

  actions: {
    refresh() {
      this.refresh()
    },
  },
});
