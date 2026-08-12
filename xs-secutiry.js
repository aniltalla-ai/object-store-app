const xsSecurity = {
  xsappname: 'object-store-app',
  'tenant-mode': 'dedicated',
  scopes: [
    {
      name: '$XSAPPNAME.read',
      description: 'Read access to object store resources'
    },
    {
      name: '$XSAPPNAME.write',
      description: 'Write and modify object store resources'
    },
    {
      name: '$XSAPPNAME.execute',
      description: 'Execute object store operations'
    }
  ],
  attributes: [
    {
      name: 'abap_instance',
      description: 'ABAP storage instance identifier used to scope access',
      valueType: 'string'
    }
  ],
  'role-templates': [
    {
      name: 'ObjectStoreUser',
      description: 'User role for the object store application',
      'scope-references': ['$XSAPPNAME.read', '$XSAPPNAME.write', '$XSAPPNAME.execute'],
      'attribute-references': ['abap_instance']
    }
  ]
};

module.exports = xsSecurity;
