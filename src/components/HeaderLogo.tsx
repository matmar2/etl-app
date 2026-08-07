import React, { useEffect, useState } from 'react';
import { Image, View } from 'react-native';
import { fetchLogo } from '../api/client';
import { FLY2SKY_LOGO } from '../print/logo';

// Operator logo for page headers. Fetches the admin-uploaded logo from the server
// (cached after first load); falls back to the bundled Fly2Sky logo offline or
// before the fetch resolves.
export default function HeaderLogo() {
  const [uri, setUri] = useState(FLY2SKY_LOGO);
  useEffect(() => { fetchLogo().then((l) => { if (l) setUri(l); }); }, []);
  return (
    <View style={{ backgroundColor: '#fff', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 }}>
      <Image source={{ uri }} style={{ width: 84, height: 22 }} resizeMode="contain" />
    </View>
  );
}
